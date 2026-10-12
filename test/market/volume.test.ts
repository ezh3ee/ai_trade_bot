import { describe, expect, it, beforeEach } from 'vitest';
import { TriggerEngine } from '../../src/market/trigger-engine.ts';
import type { Trade, TriggerEvent, VolumeEvent } from '../../src/market/trade.ts';
import { minuteIndexOf } from '../../src/market/trade.ts';
import { BASE, DEFAULT_CONFIG, MINUTE, resetIds, trade } from './fixtures.ts';

function run(trades: Trade[]): VolumeEvent[] {
  const engine = new TriggerEngine(DEFAULT_CONFIG);
  const events: TriggerEvent[] = [];
  for (const t of trades) events.push(...engine.ingest(t, t.timeMs));
  return events.filter((e) => e.kind === 'VOLUME');
}

/**
 * Заполняет 10 предыдущих минут ровным объёмом `perMinute`.
 * Минуты BASE-10 .. BASE-1 получают одинаковый объём, текущая (BASE) пуста.
 */
function baseline(perMinute: number): Trade[] {
  const out: Trade[] = [];
  for (let back = 10; back >= 1; back -= 1) {
    const minuteStart = BASE - back * MINUTE;
    // 10 сделок в минуту по 1.0 = 10.0 объёма
    const perMinuteCount = 10;
    const each = perMinute / perMinuteCount;
    for (let i = 0; i < perMinuteCount; i += 1) {
      out.push(trade(minuteStart + i * 1000, 100, each));
    }
  }
  return out;
}

describe('§9C всплеск объёма', () => {
  beforeEach(resetIds);

  it('срабатывает на объём в 10x от среднего', () => {
    const burst: Trade[] = [];
    for (let i = 0; i < 100; i += 1) burst.push(trade(BASE + i * 100, 100, 1));
    const found = run([...baseline(10), ...burst]);
    expect(found).toHaveLength(1);
    expect(found[0]?.averageVolume).toBe(10);
    expect(found[0]?.ratio).toBeGreaterThan(3);
  });

  it('молчит при равномерном объёме', () => {
    const flat: Trade[] = [];
    for (let i = 0; i < 10; i += 1) flat.push(trade(BASE + i * 100, 100, 1));
    expect(run([...baseline(10), ...flat])).toHaveLength(0);
  });

  it('молчит при 3x — §9C строго ">"', () => {
    const burst: Trade[] = [];
    for (let i = 0; i < 10; i += 1) burst.push(trade(BASE + i * 100, 100, 1));
    expect(run([...baseline(10), ...burst])).toHaveLength(0);
  });

  it('невалиден при пропущенной минуте', () => {
    // убираем минуту BASE-5 целиком
    const withGap = baseline(10).filter((t) => {
      const minute = Math.floor(t.timeMs / MINUTE);
      return minute !== Math.floor(BASE / MINUTE) - 5;
    });
    const burst: Trade[] = [];
    for (let i = 0; i < 100; i += 1) burst.push(trade(BASE + i * 100, 100, 1));
    expect(run([...withGap, ...burst])).toHaveLength(0);
  });

  it('невалиден при нулевом объёме в предыдущей минуте', () => {
    const zeroMinute = baseline(10).map((t) => {
      const minute = Math.floor(t.timeMs / MINUTE);
      return minute === Math.floor(BASE / MINUTE) - 3 ? { ...t, volume: 0 } : t;
    });
    const burst: Trade[] = [];
    for (let i = 0; i < 100; i += 1) burst.push(trade(BASE + i * 100, 100, 1));
    expect(run([...zeroMinute, ...burst])).toHaveLength(0);
  });

  it('минуты выровнены по UTC, а не по локальному времени', () => {
    // весь всплеск внутри одной минуты -> он попадает в ОДИН бакет
    const burstStart = BASE + 17_000;
    const burstEnd = BASE + 17_000 + 100 * 100;
    expect(minuteIndexOf(burstStart)).toBe(minuteIndexOf(burstEnd));

    const burst: Trade[] = [];
    for (let i = 0; i < 100; i += 1) burst.push(trade(burstStart + i * 100, 100, 1));
    const found = run([...baseline(10), ...burst]);

    expect(found).toHaveLength(1);
    expect(found[0]?.minuteIndex).toBe(minuteIndexOf(BASE));
    expect(found[0]?.averageVolume).toBeCloseTo(10, 6);
    // событие срабатывает на первом тике, где объём превысил 3x
    expect(found[0]?.currentMinuteVolume).toBeGreaterThan(30);
  });
});
