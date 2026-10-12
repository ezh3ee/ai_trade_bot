import { TriggerEngine } from '../src/market/trigger-engine.ts';
import { ReferenceTriggers } from '../test/market/reference.ts';
import type { Trade, TriggerEvent } from '../src/market/trade.ts';
import { DEFAULT_CONFIG, makeRandom } from '../test/market/fixtures.ts';

/**
 * Не тест. Замер в УСТАНОВИВШЕМСЯ РЕЖИМЕ.
 *
 * Окно 11 минут. Сначала прокручиваем историю, чтобы окно наполнилось,
 * потом замеряем. Наивная версия на полном окне при 1000 сделок/сек не
 * проходит минуту рынка за 3 минуты времени, поэтому для неё сделан
 * отдельный короткий замер: us/сделку меряем на 100/сек, а нагрузку на
 * loop для 300 и 1000/сек считаем умножением.
 *
 * Цифры ниже — обоснование структур данных из src/market. Если замер
 * перестанет быть честным, структуры надо менять.
 */

interface Replay {
  ingest(trade: Trade, nowMs: number): TriggerEvent[];
}

const RETENTION_MS = DEFAULT_CONFIG.retentionMs;
const RATES = [100, 300, 1000];

function generate(count: number, seed: number, perSecond: number): Trade[] {
  const rnd = makeRandom(seed);
  const out: Trade[] = [];
  let price = 100;
  let timeMs = 1_700_000_000_000;
  for (let i = 0; i < count; i += 1) {
    timeMs += Math.floor((1000 / perSecond) * (0.5 + rnd()));
    price = Math.max(1, price + (rnd() - 0.5) * 0.2);
    out.push({
      id: `t${i}`,
      timeMs,
      price: Math.round(price * 100) / 100,
      volume: Math.round((0.5 + rnd() * 1.5) * 1000) / 1000,
    });
  }
  return out;
}

interface Measurement {
  readonly usPerTrade: number;
  readonly worstTickUs: number;
}

function measure(factory: () => Replay, trades: Trade[], warmupCount: number): Measurement {
  const engine = factory();

  for (let i = 0; i < warmupCount; i += 1) {
    const t = trades[i];
    if (t === undefined) continue;
    engine.ingest(t, t.timeMs);
  }

  const started = performance.now();
  let previousMark = started;
  let worstTickUs = 0;
  for (let i = warmupCount; i < trades.length; i += 1) {
    const t = trades[i];
    if (t === undefined) continue;
    engine.ingest(t, t.timeMs);
    const mark = performance.now();
    const gapUs = (mark - previousMark) * 1000;
    if (gapUs > worstTickUs) worstTickUs = gapUs;
    previousMark = mark;
  }
  const elapsed = performance.now() - started;

  return {
    usPerTrade: (elapsed * 1000) / (trades.length - warmupCount),
    worstTickUs,
  };
}

const cpuPercent = (usPerTrade: number, perSecond: number): number =>
  (usPerTrade * perSecond) / 10_000;

console.log(`\nокно ${RETENTION_MS / 1000}с, установившийся режим\n`);
console.log('  скорость   версия      us/сделка    загрузка loop   худший тик');
console.log('  ' + '-'.repeat(72));

const fast = new Map<number, Measurement>();
for (const rate of RATES) {
  const streamSeconds = RETENTION_MS / 1000 + 30;
  const trades = generate(Math.round(streamSeconds * rate), 42, rate);
  const m = measure(() => new TriggerEngine(DEFAULT_CONFIG), trades, Math.round((RETENTION_MS / 1000) * rate));
  fast.set(rate, m);
  console.log(
    `  ${String(rate).padStart(5)}/с   быстрая   ${m.usPerTrade.toFixed(2).padStart(9)}` +
      `   ${cpuPercent(m.usPerTrade, rate).toFixed(3).padStart(10)} %` +
      `   ${m.worstTickUs.toFixed(0).padStart(8)} us`,
  );
}

const naiveRate = 100;
const naiveStreamSeconds = RETENTION_MS / 1000 + 10;
const naiveTrades = generate(Math.round(naiveStreamSeconds * naiveRate), 42, naiveRate);
const naive = measure(
  () => new ReferenceTriggers(DEFAULT_CONFIG),
  naiveTrades,
  Math.round((RETENTION_MS / 1000) * naiveRate),
);

for (const rate of RATES) {
  const isMeasured = rate === naiveRate ? '' : ' (экстраполяция)';
  console.log(
    `  ${String(rate).padStart(5)}/с   наивная   ${naive.usPerTrade.toFixed(2).padStart(9)}` +
      `   ${cpuPercent(naive.usPerTrade, rate).toFixed(1).padStart(10)} %${isMeasured}`,
  );
}

console.log('');
console.log(`  наивная версия на 100/с: худший тик ${naive.worstTickUs.toFixed(0)} us`);
console.log(`  быстрая версия на 100/с: худший тик ${fast.get(100)?.worstTickUs.toFixed(0) ?? '?'} us`);
console.log('');

const fastAt1000 = fast.get(1000);
if (fastAt1000 !== undefined) {
  console.log(`  разрыв на 1000 сделок/сек: ${(cpuPercent(naive.usPerTrade, 1000) / cpuPercent(fastAt1000.usPerTrade, 1000)).toFixed(0)}x\n`);
}
