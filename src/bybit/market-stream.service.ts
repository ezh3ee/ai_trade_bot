import { Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '../config/schema.ts';
import type { Logger } from '../config/load.ts';
import type { TriggerEngine } from '../market/trigger-engine.ts';
import type { MarketFeed } from '../market/market-feed.ts';
import type { AnalysisOrchestrator } from '../app/orchestrator.ts';
import { BybitWsClient, createBrowserWsHandle } from './bybit-ws.ts';
import { TradeStreamProcessor } from './trade-stream.ts';
import { TelegramBot } from '../telegram/telegram-bot.ts';
import type { TelegramFeedService } from '../telegram/status-feed.ts';
import { TelegramModule } from '../telegram/telegram.module.ts';
import { AiModule } from '../ai/ai.module.ts';
import { MarketModule } from '../market/market.module.ts';
import {
  APP_CONFIG,
  APP_LOGGER,
  MARKET_FEED,
  ORCHESTRATOR,
  TELEGRAM_BOT,
  TELEGRAM_FEED,
  TRIGGER_ENGINE,
} from '../tokens.ts';

/** Только жизненный цикл. Логики здесь нет. */
@Injectable()
export class MarketStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly processor: TradeStreamProcessor;
  private readonly ws: BybitWsClient;

  constructor(
    @Inject(TRIGGER_ENGINE) engine: TriggerEngine,
    @Inject(MARKET_FEED) feed: MarketFeed,
    @Inject(ORCHESTRATOR) orchestrator: AnalysisOrchestrator,
    @Inject(TELEGRAM_BOT) private readonly telegram: TelegramBot,
    @Inject(TELEGRAM_FEED) private readonly status: TelegramFeedService,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(APP_LOGGER) private readonly log: Logger,
  ) {
    this.processor = new TradeStreamProcessor(
      engine,
      feed,
      log,
      Date.now,
      (event) => {
        void orchestrator.onTrigger(event);
      },
      () => this.totalIgnored(),
    );

    this.ws = new BybitWsClient({
      url: config.bybit.wsUrl,
      symbol: config.bybit.symbol,
      log,
      connect: createBrowserWsHandle,
      maxGapMs: config.triggers.staleAfterMs,
      onConnected: () => {
        this.status.setConnected(true);
      },
      onDisconnected: () => {
        this.status.setConnected(false);
      },
      onTrades: (trades) => {
        this.processor.process(trades);
        this.status.setTrades(this.processor.totalTrades);
        this.status.setPrice(feed.priceNow(), feed.priceTimeMs());
      },
      onReset: (reason) => {
        this.processor.reset(reason);
      },
      onTicker: (update) => {
        this.processor.applyTicker(update);
        this.status.setTicker(feed.ticker().markPrice, feed.ticker().fundingRate);
      },
    });
  }

  onModuleInit(): void {
    this.log.info('подключаюсь к бирже');
    this.ws.start();
  }

  onModuleDestroy(): void {
    this.ws.stop();
    this.telegram.logOnly(`поток остановлен, сделок ${this.processor.totalTrades}`);
  }

  private totalIgnored(): number {
    return Object.values(this.ws.ignoredSummary()).reduce((sum, n) => sum + n, 0);
  }
}

@Module({
  imports: [MarketModule, TelegramModule, AiModule],
  providers: [MarketStreamService],
  exports: [MarketStreamService],
})
export class BybitModule {}