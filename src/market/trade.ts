export const MINUTE_MS = 60_000;

/** Одна сделка. Поля соответствуют полям Bybit V5 publicTrade: T, p, v, i. */
export interface Trade {
  /** Bybit `i` — уникальный id сделки. Ключ дедупликации. */
  readonly id: string;
  /** Bybit `T` — время исполнения в миллисекундах epoch (UTC). */
  readonly timeMs: number;
  /** Bybit `p` — цена. */
  readonly price: number;
  /** Bybit `v` — объём в базовом активе. */
  readonly volume: number;
}

export type Direction = 'UP' | 'DOWN';

export interface SpikeEvent {
  readonly kind: 'SPIKE';
  readonly direction: Direction;
  readonly changePct: number;
  readonly referencePrice: number;
  readonly referenceTimeMs: number;
  readonly currentPrice: number;
  readonly currentTimeMs: number;
}

export interface BreakoutEvent {
  readonly kind: 'BREAKOUT';
  readonly direction: Direction;
  readonly level: number;
  readonly previousPrice: number;
  readonly currentPrice: number;
  readonly currentTimeMs: number;
}

export interface VolumeEvent {
  readonly kind: 'VOLUME';
  readonly currentMinuteVolume: number;
  readonly averageVolume: number;
  readonly ratio: number;
  readonly minuteIndex: number;
}

export interface PlannedEvent {
  readonly kind: 'PLANNED';
  readonly currentPrice: number;
  readonly currentTimeMs: number;
}

export type TriggerEvent = SpikeEvent | BreakoutEvent | VolumeEvent | PlannedEvent;

/** Индекс минуты по epoch. Всегда выровнен по UTC. */
export function minuteIndexOf(timeMs: number): number {
  return Math.floor(timeMs / MINUTE_MS);
}
