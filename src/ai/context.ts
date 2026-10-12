import type { TriggerEvent } from '../market/trade.ts';
import type { TickerSnapshot } from '../bybit/ticker.ts';

/**
 * Неизменяемый снимок рынка на момент запуска анализа (§10).
 *
 * Снимок именно неизменяемый: LLM отвечает 5–30 секунд, за это время рынок
 * уезжает. Анализ должен опираться на те данные, которые он видел, а не на
 * те, что случайно оказались в памяти к моменту ответа.
 */
export interface MarketContext {
  readonly symbol: string;
  readonly category: string;
  /** Когда сделан снимок (ISO). */
  readonly capturedAt: string;
  readonly capturedAtMs: number;
  readonly lastTradePrice: number | undefined;
  readonly lastTradeAtMs: number | undefined;
  readonly ticker: TickerSnapshot;
  /** Что именно сработало. */
  readonly trigger: TriggerSummary;
  /** Параметры позиции пользователя, если заданы (§10, §12). */
  readonly position: PositionInfo;
}

export interface TriggerSummary {
  readonly kind: TriggerEvent['kind'];
  readonly reason: string;
  readonly headline: string;
  readonly changePct1m: number | undefined;
  readonly volumeRatio: number | undefined;
  readonly level: number | undefined;
  readonly levelSide: 'UP' | 'DOWN' | undefined;
}

export interface PositionInfo {
  readonly direction: 'LONG' | 'SHORT' | undefined;
  readonly entryPrice: number | undefined;
  readonly leverage: number | undefined;
  readonly size: number | undefined;
  readonly liquidationPrice: number | undefined;
}

export const EMPTY_POSITION: PositionInfo = {
  direction: undefined,
  entryPrice: undefined,
  leverage: undefined,
  size: undefined,
  liquidationPrice: undefined,
};

export function describeTrigger(event: TriggerEvent): TriggerSummary {
  switch (event.kind) {
    case 'SPIKE':
      return {
        kind: event.kind,
        reason: `резкое изменение цены: ${(event.changePct * 100).toFixed(3)}% за минуту`,
        headline: `цена ${event.currentPrice} против ${event.referencePrice} минуту назад (${(event.changePct * 100).toFixed(3)}%)`,
        changePct1m: event.changePct,
        volumeRatio: undefined,
        level: undefined,
        levelSide: event.direction,
      };
    case 'BREAKOUT':
      return {
        kind: event.kind,
        reason: `пробой уровня ${event.level} в сторону ${event.direction === 'UP' ? 'вверх' : 'вниз'}`,
        headline: `цена пробила уровень ${event.level} в сторону ${event.direction === 'UP' ? 'вверх' : 'вниз'} и стоит ${event.currentPrice}`,
        changePct1m: undefined,
        volumeRatio: undefined,
        level: event.level,
        levelSide: event.direction,
      };
    case 'VOLUME':
      return {
        kind: event.kind,
        reason: `объём текущей минуты в ${event.ratio.toFixed(1)} раза выше среднего`,
        headline: `объём текущей минуты в ${event.ratio.toFixed(1)} раза выше среднего`,
        changePct1m: undefined,
        volumeRatio: event.ratio,
        level: undefined,
        levelSide: undefined,
      };
    case 'PLANNED':
      return {
        kind: event.kind,
        reason: 'плановый анализ по расписанию, рынок спокоен',
        headline: `плановый анализ, цена ${event.currentPrice}`,
        changePct1m: undefined,
        volumeRatio: undefined,
        level: undefined,
        levelSide: undefined,
      };
  }
}

export function buildMarketContext(options: {
  readonly symbol: string;
  readonly category: string;
  readonly nowMs: number;
  readonly lastTradePrice: number | undefined;
  readonly lastTradeAtMs: number | undefined;
  readonly ticker: TickerSnapshot;
  readonly trigger: TriggerEvent;
  readonly position?: PositionInfo;
}): MarketContext {
  return {
    symbol: options.symbol,
    category: options.category,
    capturedAt: new Date(options.nowMs).toISOString(),
    capturedAtMs: options.nowMs,
    lastTradePrice: options.lastTradePrice,
    lastTradeAtMs: options.lastTradeAtMs,
    ticker: options.ticker,
    trigger: describeTrigger(options.trigger),
    position: options.position ?? EMPTY_POSITION,
  };
}