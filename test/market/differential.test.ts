import { describe, expect, it } from 'vitest';
import { TriggerEngine } from '../../src/market/trigger-engine.ts';
import type { Trade, TriggerEvent } from '../../src/market/trade.ts';
import { ReferenceTriggers } from './reference.ts';
import { DEFAULT_CONFIG, MINUTE, SECOND, makeRandom, trade } from './fixtures.ts';

/**
 * Главный тест. Оптимизированная версия и медленный эталон получают
 * одинаковые случайные сделки. Каждое событие должно совпасть.
 *
 * Если быстрый код где-то соврал (забыл обновить уровень, потерял
 * пересечение, не так посчитал минуты) — тест это поймает.
 */
function generate(seed: number, count: number): Trade[] {
  const rnd = makeRandom(seed);
  const out: Trade[] = [];
  let price = 100;
  let timeMs = 1_700_000_000_000;

  for (let i = 0; i < count; i += 1) {
    // 1-12 сделок в секунду
    timeMs += Math.floor(rnd() * 12) * 100;
    // случайное блуждание + изредка сильный толчок
    const drift = (rnd() - 0.5) * 0.4;
    const jump = rnd() < 0.01 ? (rnd() - 0.5) * 6 : 0;
    price = Math.max(1, price + drift + jump);
    // объём: обычно 0.5-2, иногда всплеск
    const volume = rnd() < 0.02 ? 20 + rnd() * 60 : 0.5 + rnd() * 1.5;
    out.push(trade(timeMs, Math.round(price * 100) / 100, Math.round(volume * 1000) / 1000));
  }
  return out;
}

function replay(factory: () => { ingest(t: Trade, nowMs: number): TriggerEvent[] }, trades: Trade[]) {
  const engine = factory();
  const out: TriggerEvent[] = [];
  for (const t of trades) out.push(...engine.ingest(t, t.timeMs));
  return out;
}

describe('сравнение с эталоном', () => {
  const seeds = [1, 7, 42, 1337, 99991, 555555];

  it.each(seeds)('сид %i — события совпадают полностью', (seed) => {
    const trades = generate(seed, 4000);

    const fast = replay(() => new TriggerEngine(DEFAULT_CONFIG), trades);
    const slow = replay(() => new ReferenceTriggers(DEFAULT_CONFIG), trades);

    expect(fast.length).toBe(slow.length);
    expect(fast).toEqual(slow);
  });

  it.each(seeds)('сид %i — события не пустые (тест реально что-то проверяет)', (seed) => {
    const trades = generate(seed, 4000);
    const fast = replay(() => new TriggerEngine(DEFAULT_CONFIG), trades);

    const kinds = new Set(fast.map((e) => e.kind));
    expect(kinds.size).toBeGreaterThan(0);
    expect(fast.length).toBeGreaterThan(10);
  });
});

describe('сравнение с эталоном при аномалиях', () => {
  it('совпадает при всплеске цены без смены объёма', () => {
    const rnd = makeRandom(31337);
    const trades: Trade[] = [];
    let price = 100;
    let timeMs = 1_700_000_000_000;
    for (let i = 0; i < 3000; i += 1) {
      timeMs += Math.floor(rnd() * 10) * 100;
      price = Math.max(1, price + (rnd() - 0.5) * 3);
      trades.push(trade(timeMs, Math.round(price * 100) / 100, 1));
    }

    const fast = replay(() => new TriggerEngine(DEFAULT_CONFIG), trades);
    const slow = replay(() => new ReferenceTriggers(DEFAULT_CONFIG), trades);
    expect(fast).toEqual(slow);
  });

  it('совпадает при длительной паузе в данных', () => {
    const trades: Trade[] = [];
    let timeMs = 1_700_000_000_000;
    for (let i = 0; i < 500; i += 1) {
      timeMs += i % 100 === 99 ? 5 * MINUTE : SECOND;
      trades.push(trade(timeMs, 100 + (i % 7), 1));
    }
    const fast = replay(() => new TriggerEngine(DEFAULT_CONFIG), trades);
    const slow = replay(() => new ReferenceTriggers(DEFAULT_CONFIG), trades);
    expect(fast).toEqual(slow);
  });

  it('совпадает при плоской цене', () => {
    const trades: Trade[] = [];
    let timeMs = 1_700_000_000_000;
    for (let i = 0; i < 2000; i += 1) {
      timeMs += SECOND;
      trades.push(trade(timeMs, 100, 1));
    }
    expect(replay(() => new TriggerEngine(DEFAULT_CONFIG), trades)).toEqual(
      replay(() => new ReferenceTriggers(DEFAULT_CONFIG), trades),
    );
  });
});
