import type { Trade } from '../../src/market/trade.ts';
import type { TriggerEngineConfig } from '../../src/market/trigger-engine.ts';

/** Начальные значения из §9 спецификации. */
export const DEFAULT_CONFIG: TriggerEngineConfig = {
  spikeThreshold: 0.003, //   SPIKE_PCT
  volumeMultiplier: 3, //      VOL_MULT
  breakoutWindowMs: 600_000, // WINDOW_MINUTES = 10
  maturityMs: 60_000, //       SPIKE_WINDOW_SECONDS = 60
  retentionMs: 660_000,
  dedupMs: 660_000,
  staleAfterMs: 10_000,
  cooldownMs: 60_000, //       COOLDOWN_MS
};

export const SECOND = 1000;
export const MINUTE = 60_000;

/** Ровная база, кратная минуте UTC. */
export const BASE = 1_700_000_040_000;

let counter = 0;

export function resetIds(): void {
  counter = 0;
}

export function trade(timeMs: number, price: number, volume = 1): Trade {
  counter += 1;
  return { id: `t${counter}`, timeMs, price, volume };
}

/** Ровно `count` сделок по одной в секунду, начиная с `startMs`. */
export function tradesEverySecond(
  startMs: number,
  count: number,
  price: number,
): Trade[] {
  const out: Trade[] = [];
  for (let i = 0; i < count; i += 1) out.push(trade(startMs + i * SECOND, price));
  return out;
}

/** Детерминированный ГПСЧ, чтобы падение воспроизводилось. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
