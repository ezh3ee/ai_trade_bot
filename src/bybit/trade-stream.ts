import type { Logger } from '../config/load.ts';
import type { TriggerEngine } from '../market/trigger-engine.ts';
import type { Trade, TriggerEvent } from '../market/trade.ts';
import type { MarketFeed } from '../market/market-feed.ts';
import type { TickerData } from './ticker.ts';
import { formatHeartbeat } from '../telegram/status.ts';

/** Как часто печатать пульс. Одна строка в минуту вместо 60 в секунду. */
const HEARTBEAT_MS = 60_000;

/**
 * Прогоняет сделки через триггеры и печатает происходящее (§14).
 *
 * Чистая логика: ни одного декоратора, ни одного импорта Nest.
 */
export class TradeStreamProcessor {
  private tradeCount = 0;
  private windowCount = 0;
  private lastHeartbeatMs: number;

  constructor(
    private readonly engine: TriggerEngine,
    private readonly feed: MarketFeed,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
    private readonly onTrigger: (event: TriggerEvent) => void = () => {},
    private readonly ignoredCount: () => number = () => 0,
  ) {
    this.lastHeartbeatMs = now();
  }

  get totalTrades(): number {
    return this.tradeCount;
  }

  applyTicker(update: TickerData): void {
    this.feed.applyTicker(update, this.now());
  }

  /** Счётчик и окно после разрыва в данных (§8). */
  reset(reason: string): void {
    this.engine.reset();
    this.tradeCount = 0;
    this.windowCount = 0;
    this.lastHeartbeatMs = this.now();
    this.log.warn('окно триггеров сброшено, прогрев заново', { причина: reason });
  }

  process(trades: readonly Trade[]): void {
    if (trades.length === 0) return;
    const nowMs = this.now();

    for (const trade of trades) {
      this.feed.noteTrade(trade);
      for (const event of this.ingestOne(trade, nowMs)) this.report(event);
    }

    this.tradeCount += trades.length;
    this.windowCount += trades.length;
    this.heartbeat(nowMs);
  }

  private ingestOne(trade: Trade, nowMs: number): TriggerEvent[] {
    try {
      return this.engine.ingest(trade, nowMs);
    } catch (error: unknown) {
      this.log.error('сделка отброшена', { id: trade.id, ошибка: String(error) });
      return [];
    }
  }

  private report(event: TriggerEvent): void {
    this.logTrigger(event);
    try {
      this.onTrigger(event);
    } catch (error: unknown) {
      this.log.error('обработчик триггера упал', { ошибка: String(error) });
    }
  }

  /**
   * Одна строка в минуту. Раньше было три строки в секунду — это мусор,
   * в котором не видно ничего полезного (§14 логирование должно быть читаемым).
   */
  private heartbeat(nowMs: number): void {
    const elapsed = nowMs - this.lastHeartbeatMs;
    if (elapsed < HEARTBEAT_MS) return;

    const ticker = this.feed.ticker();
    this.log.info(
      formatHeartbeat({
        symbol: ticker.symbol,
        tradesTotal: this.tradeCount,
        tradesInWindow: this.windowCount,
        windowMs: elapsed,
        price: this.feed.priceNow(),
        markPrice: ticker.markPrice,
        fundingRate: ticker.fundingRate,
        connected: true,
        ignored: this.ignoredCount(),
      }),
    );

    this.windowCount = 0;
    this.lastHeartbeatMs = nowMs;
  }

  private logTrigger(event: TriggerEvent): void {
    switch (event.kind) {
      case 'SPIKE':
        this.log.warn(`⚡ СПАЙК ${event.direction} ${(event.changePct * 100).toFixed(3)}%`, {
          цена: event.currentPrice,
          минуту_назад: event.referencePrice,
        });
        return;
      case 'BREAKOUT':
        this.log.warn(`🚧 ПРОБОЙ ${event.direction} через ${event.level}`, {
          цена: event.currentPrice,
          секунду_назад: event.previousPrice,
        });
        return;
      case 'VOLUME':
        this.log.warn(`🌊 ОБЪЁМ x${event.ratio.toFixed(1)} к среднему`, {
          за_минуту: Number(event.currentMinuteVolume.toFixed(2)),
          среднее: Number(event.averageVolume.toFixed(2)),
        });
        return;
      case 'PLANNED':
        return;
    }
  }
}