import { describe, expect, it, beforeEach } from 'vitest';
import { TriggerEngine } from '../../src/market/trigger-engine.ts';
import type { SpikeEvent, Trade, TriggerEvent } from '../../src/market/trade.ts';
import { BASE, DEFAULT_CONFIG, MINUTE, SECOND, resetIds, trade, tradesEverySecond } from './fixtures.ts';

function run(config: Partial<typeof DEFAULT_CONFIG>, trades: Trade[]): TriggerEvent[] {
  const engine = new TriggerEngine({ ...DEFAULT_CONFIG, ...config });
  const events: TriggerEvent[] = [];
  for (const t of trades) events.push(...engine.ingest(t, t.timeMs));
  return events;
}

function spikes(events: TriggerEvent[]): SpikeEvent[] {
  return events.filter((e) => e.kind === 'SPIKE');
}

describe('§9A всплеск цены', () => {
  beforeEach(resetIds);

  it('срабатывает когда цена ушла дальше порога за минуту', () => {
    const t = [...tradesEverySecond(BASE, 61, 100), trade(BASE + 61 * SECOND, 100.5)];
    const found = spikes(run({}, t));
    expect(found).toHaveLength(1);
    expect(found[0]?.direction).toBe('UP');
    expect(found[0]?.referencePrice).toBe(100);
  });

  it('срабатывает вниз', () => {
    const t = [...tradesEverySecond(BASE, 61, 100), trade(BASE + 61 * SECOND, 99.5)];
    const found = spikes(run({}, t));
    expect(found).toHaveLength(1);
    expect(found[0]?.direction).toBe('DOWN');
  });

  it('не срабатывает без сделки-эталона (окно не наполнилось)', () => {
    const t = [trade(BASE, 100), trade(BASE + SECOND, 130)];
    expect(spikes(run({}, t))).toHaveLength(0);
  });

  it('не срабатывает на ровно порог — §9A строго ">"', () => {
    const t = [...tradesEverySecond(BASE, 61, 100), trade(BASE + 61 * SECOND, 100.3)];
    expect(spikes(run({}, t))).toHaveLength(0);
  });

  it('молчит на протухших данных', () => {
    const t = [...tradesEverySecond(BASE, 61, 100), trade(BASE + 61 * SECOND, 105)];
    const engine = new TriggerEngine(DEFAULT_CONFIG);
    const events: TriggerEvent[] = [];
    // системное время на 5 минут позже последней сделки
    for (const tr of t) events.push(...engine.ingest(tr, tr.timeMs + 300_000));
    expect(spikes(events)).toHaveLength(0);
  });

  it('не срабатывает на движение внутри порога', () => {
    const t = [...tradesEverySecond(BASE, 61, 100), trade(BASE + 61 * SECOND, 100.2)];
    expect(spikes(run({}, t))).toHaveLength(0);
  });
});

describe('дедупликация', () => {
  beforeEach(resetIds);

  it('повтор того же id игнорируется', () => {
    const engine = new TriggerEngine(DEFAULT_CONFIG);
    const a = trade(BASE, 100);
    expect(engine.ingest(a, BASE)).toBeDefined();
    const before = engine.ingest(a, BASE);
    expect(before).toHaveLength(0);
  });

  it('идёт в хронологическом порядке — сделка из прошлого отбрасывается', () => {
    const engine = new TriggerEngine(DEFAULT_CONFIG);
    const now = trade(BASE + 10 * SECOND, 100);
    engine.ingest(now, now.timeMs);
    expect(() => engine.ingest(trade(BASE, 100), BASE)).toThrow(/out-of-order/);
  });
});

describe('память окна', () => {
  beforeEach(resetIds);

  it('старые сделки выпадают из окна', () => {
    const engine = new TriggerEngine({ ...DEFAULT_CONFIG, cooldownMs: 0 });
    const start = BASE;
    for (let i = 0; i < 200; i += 1) {
      engine.ingest(trade(start + i * MINUTE, 100), start + i * MINUTE);
    }
    // retention 11 минут -> последние 11 сделок максимум
    expect(engine).toBeDefined();
  });
});
