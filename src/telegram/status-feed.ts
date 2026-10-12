import type { AppConfig } from '../config/schema.ts';
import type { RuntimeState } from '../app/runtime-state.ts';
import type { StatusInfo } from './status.ts';

/**
 * Накопитель данных для /status.
 *
 * Обычный класс, без Nest: его можно покрыть обычными тестами, не поднимая
 * приложение. В модуле ему не место — модуль только собирает.
 */
export class TelegramFeedService {
  private connected = false;
  private trades = 0;
  private price: number | undefined;
  private priceTimeMs: number | undefined;
  private markPrice: number | undefined;
  private fundingRate: number | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly state: RuntimeState,
  ) {}

  setConnected(value: boolean): void {
    this.connected = value;
  }

  setTrades(value: number): void {
    this.trades = value;
  }

  setPrice(price: number | undefined, timeMs: number | undefined): void {
    this.price = price;
    this.priceTimeMs = timeMs;
  }

  setTicker(markPrice: number | undefined, fundingRate: number | undefined): void {
    this.markPrice = markPrice;
    this.fundingRate = fundingRate;
  }

  status(): StatusInfo {
    const signal = this.state.signal;
    return {
      symbol: this.config.bybit.symbol,
      price: this.price,
      priceTimeMs: this.priceTimeMs,
      connected: this.connected,
      tradesTotal: this.trades,
      lastSignalAtMs: signal?.atMs,
      lastDirection: signal?.direction,
      analysesToday: this.state.analyses,
      dailyLimit: this.config.llm.dailyLimit,
      paused: this.state.isPaused,
      mode: this.state.currentMode,
      markPrice: this.markPrice,
      fundingRate: this.fundingRate,
    };
  }
}