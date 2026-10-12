import type { Logger } from '../config/load.ts';
import type { TriggerEngine } from '../market/trigger-engine.ts';
import type { Trade, TriggerEvent } from '../market/trade.ts';
import type { MarketFeed } from '../market/market-feed.ts';
import type { TickerData } from './ticker.ts';

/**
 * Прогоняет сделки через триггеры и печатает происходящее (§14).
 *
 * Чистая логика: ни одного декоратора, ни одного импорта Nest. Проверяется
 * обычными тестами без поднятия приложения.
 */
export class TradeStreamProcessor {
  private tradeCount = 0;
  private lastLoggedSecond = 0;

  constructor(
    private readonly engine: TriggerEngine,
    private readonly feed: MarketFeed,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
    private readonly onTrigger: (event: TriggerEvent) => void = () => {},
  ) {}

  get totalTrades(): number {
    return this.tradeCount;
  }

  /** Применяет дельту тикера: пришедшие поля обновляются, остальные живут. */
  applyTicker(update: TickerData): void {
    this.feed.applyTicker(update, this.now());
  }

  /** Счётчик и окно после разрыва в данных (§8: не считать по дырявым данным). */
  reset(reason: string): void {
    this.engine.reset();
    this.tradeCount = 0;
    this.lastLoggedSecond = 0;
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
    this.logRate(trades);
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

  /** Не засоряем лог каждой сделкой — раз в секунду одна строка. */
  private logRate(trades: readonly Trade[]): void {
    const second = Math.floor(this.now() / 1000);
    if (second === this.lastLoggedSecond) return;
    this.lastLoggedSecond = second;

    const newest = trades[trades.length - 1];
    this.log.debug('сделки', {
      всего: this.tradeCount,
      в_пакете: trades.length,
      цена: newest?.price ?? '—',
    });
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