import { TickerState } from '../bybit/ticker.ts';
import type { TickerData, TickerSnapshot } from '../bybit/ticker.ts';
import type { Trade } from './trade.ts';

/**
 * Общее наблюдаемое состояние рынка.
 *
 * Существует, чтобы разорвать цикл: и обработчик сделок, и оркестратор
 * должны видеть одно и то же, а обработчик создаётся позже оркестратора.
 *
 * Обычный класс, без Nest.
 */
export class MarketFeed {
  private readonly tickerState: TickerState;
  private price: number | undefined;
  private priceAtMs: number | undefined;

  constructor(symbol: string, nowMs: number) {
    this.tickerState = new TickerState(symbol, nowMs);
  }

  applyTicker(update: TickerData, nowMs: number): void {
    this.tickerState.merge(update, nowMs);
  }

  noteTrade(trade: Trade): void {
    this.price = trade.price;
    this.priceAtMs = trade.timeMs;
  }

  ticker(): TickerSnapshot {
    return this.tickerState.get();
  }

  priceNow(): number | undefined {
    return this.price;
  }

  priceTimeMs(): number | undefined {
    return this.priceAtMs;
  }
}