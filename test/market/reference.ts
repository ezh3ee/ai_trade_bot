import type { Trade, TriggerEvent } from '../../src/market/trade.ts';
import { minuteIndexOf } from '../../src/market/trade.ts';
import type { TriggerEngineConfig } from '../../src/market/trigger-engine.ts';

/**
 * ЭТАЛОН. Медленная версия триггеров, написанная «в лоб».
 *
 * Здесь специально используются filter / reduce / перебор всего окна —
 * то есть ровно то, чего нельзя делать на горячем пути. Медленно, зато
 * видно глазами, что именно проверяется.
 *
 * Тесты сравнивают результат этой версии с оптимизированной на одинаковых
 * случайных данных. Совпало -> оптимизированная версия не наврала.
 *
 * Смысловая семантика та же, что в оптимизированной:
 *   - границы окон считаются по времени СДЕЛКИ (trade.timeMs)
 *   - nowMs используется только для протухания и кулдауна
 */
export class ReferenceTriggers {
  private trades: Trade[] = [];
  private readonly seenIds = new Set<string>();
  private readonly buckets = new Map<number, number>();
  private readonly lastFiredAt = new Map<TriggerEvent['kind'], number>();

  constructor(private readonly config: TriggerEngineConfig) {}

  ingest(trade: Trade, nowMs: number): TriggerEvent[] {
    if (this.seenIds.has(trade.id)) return [];

    const last = this.trades[this.trades.length - 1];
    if (last !== undefined && trade.timeMs < last.timeMs) {
      throw new Error(`out-of-order trade: ${trade.id}`);
    }

    this.seenIds.add(trade.id);
    this.trades.push(trade);

    this.trades = this.trades.filter(
      (t) => t.timeMs > trade.timeMs - this.config.retentionMs,
    );

    const minute = minuteIndexOf(trade.timeMs);
    this.buckets.set(minute, (this.buckets.get(minute) ?? 0) + trade.volume);

    const events: TriggerEvent[] = [];
    const spike = this.spike(trade.timeMs, nowMs);
    if (spike !== undefined) this.push(events, spike, nowMs);

    const breakout = this.breakout(trade.timeMs, nowMs);
    if (breakout !== undefined) this.push(events, breakout, nowMs);

    const volume = this.volume(nowMs);
    if (volume !== undefined) this.push(events, volume, nowMs);

    return events;
  }

  private spike(now: number, wallNow: number): TriggerEvent | undefined {
    const maturityBoundary = now - this.config.maturityMs;

    const mature = this.trades.filter((t) => t.timeMs <= maturityBoundary);
    const reference = mature[mature.length - 1];

    const current = this.trades[this.trades.length - 1];
    const previous = this.trades[this.trades.length - 2];
    if (reference === undefined || current === undefined) return undefined;
    if (reference.id === current.id) return undefined;
    if (reference.price <= 0) return undefined;
    if (wallNow - current.timeMs > this.config.staleAfterMs) return undefined;

    const changePct = (current.price - reference.price) / reference.price;
    if (Math.abs(changePct) <= this.config.spikeThreshold) return undefined;

    return {
      kind: 'SPIKE',
      direction: changePct > 0 ? 'UP' : 'DOWN',
      changePct,
      referencePrice: reference.price,
      referenceTimeMs: reference.timeMs,
      currentPrice: current.price,
      currentTimeMs: current.timeMs,
    };
  }

  private breakout(now: number, wallNow: number): TriggerEvent | undefined {
    const maturityBoundary = now - this.config.maturityMs;
    const windowStart = now - this.config.breakoutWindowMs;

    const level = this.trades.filter(
      (t) => t.timeMs <= maturityBoundary && t.timeMs > windowStart,
    );
    if (level.length === 0) return undefined;

    const maxOld = level.reduce((acc, t) => (t.price > acc ? t.price : acc), level[0]?.price ?? 0);
    const minOld = level.reduce((acc, t) => (t.price < acc ? t.price : acc), level[0]?.price ?? 0);

    const current = this.trades[this.trades.length - 1];
    const previous = this.trades[this.trades.length - 2];
    if (current === undefined || previous === undefined) return undefined;
    if (wallNow - current.timeMs > this.config.staleAfterMs) return undefined;

    if (previous.price <= maxOld && current.price > maxOld) {
      return {
        kind: 'BREAKOUT',
        direction: 'UP',
        level: maxOld,
        previousPrice: previous.price,
        currentPrice: current.price,
        currentTimeMs: current.timeMs,
      };
    }
    if (previous.price >= minOld && current.price < minOld) {
      return {
        kind: 'BREAKOUT',
        direction: 'DOWN',
        level: minOld,
        previousPrice: previous.price,
        currentPrice: current.price,
        currentTimeMs: current.timeMs,
      };
    }
    return undefined;
  }

  private volume(wallNow: number): TriggerEvent | undefined {
    const currentMinute = minuteIndexOf(wallNow);

    let sum = 0;
    for (let back = 2; back <= 10; back += 1) {
      const v = this.buckets.get(currentMinute - back);
      if (v === undefined || v <= 0) return undefined;
      sum += v;
    }
    const averageVolume = sum / 9;
    if (averageVolume <= 0) return undefined;

    const currentMinuteVolume = this.buckets.get(currentMinute) ?? 0;
    const ratio = currentMinuteVolume / averageVolume;
    if (ratio <= this.config.volumeMultiplier) return undefined;

    return {
      kind: 'VOLUME',
      currentMinuteVolume,
      averageVolume,
      ratio,
      minuteIndex: currentMinute,
    };
  }

  private push(events: TriggerEvent[], event: TriggerEvent, nowMs: number): void {
    const last = this.lastFiredAt.get(event.kind);
    if (last !== undefined && nowMs - last < this.config.cooldownMs) return;
    this.lastFiredAt.set(event.kind, nowMs);
    events.push(event);
  }
}
