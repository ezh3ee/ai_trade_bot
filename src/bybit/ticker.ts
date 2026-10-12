import { z } from 'zod';

/**
 * Топик tickers: mark price, index price, funding, объёмы.
 *
 * Bybit шлёт ТОЛЬКО ИЗМЕНИВШИЕСЯ поля (§8). Поэтому схема делает все поля
 * необязательными, а TickerState накапливает последние известные значения.
 */

const decimalString = z.string().transform((value, ctx): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: 'custom', message: `ожидалось число, пришло "${value}"` });
    return z.NEVER;
  }
  return parsed;
});

const optionalDecimal = decimalString.optional();
const optionalMillis = z.number().int().optional();

export const tickerDataSchema = z.object({
  symbol: z.string(),
  lastPrice: optionalDecimal,
  indexPrice: optionalDecimal,
  markPrice: optionalDecimal,
  prevPrice24h: optionalDecimal,
  price24hPcnt: optionalDecimal,
  highPrice24h: optionalDecimal,
  lowPrice24h: optionalDecimal,
  prevPrice1h: optionalDecimal,
  openInterest: optionalDecimal,
  turnover24h: optionalDecimal,
  volume24h: optionalDecimal,
  fundingRate: optionalDecimal,
  nextFundingTime: optionalMillis,
  bid1Price: optionalDecimal,
  ask1Price: optionalDecimal,
});

export type TickerData = z.infer<typeof tickerDataSchema>;

export const tickerMessageSchema = z.object({
  topic: z.string().startsWith('tickers.'),
  ts: z.number().optional(),
  data: tickerDataSchema,
});

/** Накопленное состояние: каждый тик обновляет только пришедшие поля. */
export interface TickerSnapshot {
  readonly symbol: string;
  readonly lastPrice: number | undefined;
  readonly markPrice: number | undefined;
  readonly indexPrice: number | undefined;
  readonly prevPrice24h: number | undefined;
  readonly changePct24h: number | undefined;
  readonly high24h: number | undefined;
  readonly low24h: number | undefined;
  readonly fundingRate: number | undefined;
  readonly nextFundingTimeMs: number | undefined;
  readonly openInterest: number | undefined;
  readonly volume24h: number | undefined;
  readonly updatedAtMs: number;
}

const EMPTY: Omit<TickerSnapshot, 'symbol' | 'updatedAtMs'> = {
  lastPrice: undefined,
  markPrice: undefined,
  indexPrice: undefined,
  prevPrice24h: undefined,
  changePct24h: undefined,
  high24h: undefined,
  low24h: undefined,
  fundingRate: undefined,
  nextFundingTimeMs: undefined,
  openInterest: undefined,
  volume24h: undefined,
};

export class TickerState {
  private snapshot: TickerSnapshot;

  constructor(symbol: string, nowMs: number) {
    this.snapshot = { ...EMPTY, symbol, updatedAtMs: nowMs };
  }

  /** Применяет дельту: пришедшие поля перезаписываются, остальные живут дальше. */
  merge(data: TickerData, nowMs: number): void {
    this.snapshot = {
      symbol: data.symbol,
      lastPrice: data.lastPrice ?? this.snapshot.lastPrice,
      markPrice: data.markPrice ?? this.snapshot.markPrice,
      indexPrice: data.indexPrice ?? this.snapshot.indexPrice,
      prevPrice24h: data.prevPrice24h ?? this.snapshot.prevPrice24h,
      changePct24h: data.price24hPcnt ?? this.snapshot.changePct24h,
      high24h: data.highPrice24h ?? this.snapshot.high24h,
      low24h: data.lowPrice24h ?? this.snapshot.low24h,
      fundingRate: data.fundingRate ?? this.snapshot.fundingRate,
      nextFundingTimeMs: data.nextFundingTime ?? this.snapshot.nextFundingTimeMs,
      openInterest: data.openInterest ?? this.snapshot.openInterest,
      volume24h: data.volume24h ?? this.snapshot.volume24h,
      updatedAtMs: nowMs,
    };
  }

  get(): TickerSnapshot {
    return this.snapshot;
  }
}

export function tickerTopic(symbol: string): string {
  return `tickers.${symbol}`;
}

/** Достаёт дельту тикера. Не тикером (и не чем попало) -> undefined. */
export function parseTickerMessage(raw: string): { topic: string; data: TickerData } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  const result = tickerMessageSchema.safeParse(parsed);
  if (!result.success) return undefined;
  return { topic: result.data.topic, data: result.data.data };
}