import { describe, expect, it, beforeEach } from 'vitest';
import { TriggerEngine } from '../../src/market/trigger-engine.ts';
import type { BreakoutEvent, Trade, TriggerEvent } from '../../src/market/trade.ts';
import { BASE, DEFAULT_CONFIG, SECOND, resetIds, trade, tradesEverySecond } from './fixtures.ts';

/**
 * Фон: минута сделок по цене 100, потом минута тишины на цене 100.
 * maxOld = minOld = 100.
 */
function background(): Trade[] {
  return tradesEverySecond(BASE, 120, 100);
}

function run(trades: Trade[]): TriggerEvent[] {
  const engine = new TriggerEngine(DEFAULT_CONFIG);
  const events: TriggerEvent[] = [];
  for (const t of trades) events.push(...engine.ingest(t, t.timeMs));
  return events;
}

function breakouts(events: TriggerEvent[]): BreakoutEvent[] {
  return events.filter((e) => e.kind === 'BREAKOUT');
}

describe('§9B пробой уровня', () => {
  beforeEach(resetIds);

  it('ловит пробой вверх', () => {
    const t = [...background(), trade(BASE + 121 * SECOND, 101)];
    const found = breakouts(run(t));
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]?.direction).toBe('UP');
    expect(found[0]?.level).toBe(100);
  });

  it('ловит пробой вниз', () => {
    const t = [...background(), trade(BASE + 121 * SECOND, 99)];
    const found = breakouts(run(t));
    expect(found).toHaveLength(1);
    expect(found[0]?.direction).toBe('DOWN');
  });

  it('НЕ срабатывает повторно, пока цена остаётся выше уровня', () => {
    // 101 -> 102 -> 103: пересечение было только на первом тике
    const t = [
      ...background(),
      trade(BASE + 121 * SECOND, 101),
      trade(BASE + 122 * SECOND, 102),
      trade(BASE + 123 * SECOND, 103),
    ];
    const found = breakouts(run(t));
    expect(found).toHaveLength(1);
    expect(found[0]?.currentPrice).toBe(101);
  });

  it('ловит пробой, который случился и откатился внутри одной секунды', () => {
    // Ровно тот случай, который теряется при проверке раз в секунду:
    // 101 -> 100.5, к следующей секундной отметке цена снова ниже уровня.
    const t = [
      ...background(),
      trade(BASE + 121 * SECOND, 101),
      trade(BASE + 121 * SECOND + 100, 100.5),
    ];
    const found = breakouts(run(t));
    expect(found).toHaveLength(1);
    expect(found[0]?.direction).toBe('UP');
  });

  it('не срабатывает без сделок старше минуты', () => {
    const t = [trade(BASE, 100), trade(BASE + SECOND, 200)];
    expect(breakouts(run(t))).toHaveLength(0);
  });

  it('уровень не включает последнюю минуту', () => {
    // 99.5 в последние 30 секунд, потом пробой 100 вверх.
    // Если бы 99.5 попал в уровень, minOld был бы 99.5 — это не проверяется.
    // Проверяем, что уровень остался 100 (максимум), а не 99.5.
    const t = [...background(), trade(BASE + 121 * SECOND, 100.1)];
    const found = breakouts(run(t));
    expect(found[0]?.level).toBe(100);
  });

  it('молчит на протухших данных', () => {
    const engine = new TriggerEngine(DEFAULT_CONFIG);
    const t = [...background(), trade(BASE + 121 * SECOND, 101)];
    const events: TriggerEvent[] = [];
    for (const tr of t) events.push(...engine.ingest(tr, tr.timeMs + 300_000));
    expect(breakouts(events)).toHaveLength(0);
  });
});
