import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '../config/schema.ts';
import type { Logger } from '../config/load.ts';
import type { TriggerEngine } from '../market/trigger-engine.ts';
import type { MarketFeed } from '../market/market-feed.ts';
import type { TriggerEvent } from '../market/trade.ts';
import type { AnalysisOrchestrator } from '../app/orchestrator.ts';
import { BybitWsClient, createBrowserWsHandle } from './bybit-ws.ts';
import { TradeStreamProcessor } from './trade-stream.ts';
import {
  APP_CONFIG,
  APP_LOGGER,
  MARKET_FEED,
  ORCHESTRATOR,
  TRIGGER_ENGINE,
} from '../tokens.ts';

/**
 * Только жизненный цикл: подключиться при старте, отключиться при остановке.
 *
 * Вся логика — в TradeStreamProcessor и AnalysisOrchestrator, здесь её ноль.
 */
@Injectable()
export class MarketStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly processor: TradeStreamProcessor;
  private readonly ws: BybitWsClient;

  constructor(
    @Inject(TRIGGER_ENGINE) engine: TriggerEngine,
    @Inject(MARKET_FEED) feed: MarketFeed,
    @Inject(ORCHESTRATOR) orchestrator: AnalysisOrchestrator,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(APP_LOGGER) private readonly log: Logger,
  ) {
    this.processor = new TradeStreamProcessor(engine, feed, log, Date.now, (event: TriggerEvent) => {
      void orchestrator.onTrigger(event);
    });

    this.ws = new BybitWsClient({
      url: config.bybit.wsUrl,
      symbol: config.bybit.symbol,
      log,
      connect: createBrowserWsHandle,
      maxGapMs: config.triggers.staleAfterMs,
      onTrades: (trades) => {
        this.processor.process(trades);
      },
      onReset: (reason) => {
        this.processor.reset(reason);
      },
      onTicker: (update) => {
        this.processor.applyTicker(update);
      },
    });
  }

  onModuleInit(): void {
    this.log.info('подключаюсь к бирже');
    this.ws.start();
  }

  onModuleDestroy(): void {
    this.ws.stop();
    this.log.info('поток остановлен', { всего_сделок: this.processor.totalTrades });
  }
}