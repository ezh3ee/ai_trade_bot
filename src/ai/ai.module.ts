import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/schema.ts';
import type { Logger } from '../config/load.ts';
import { LlmFactory } from './factory.ts';
import { loadPrompts } from './prompts.ts';
import type { Prompts } from './prompts.ts';
import type { LlmProvider } from './provider.ts';
import { AnalysisOrchestrator } from '../app/orchestrator.ts';
import type { MarketFeed } from '../market/market-feed.ts';
import type { RuntimeState } from '../app/runtime-state.ts';
import { MarketModule } from '../market/market.module.ts';
import type { Notifier } from '../telegram/telegram-bot.ts';
import { TelegramModule } from '../telegram/telegram.module.ts';
import {
  APP_CONFIG,
  APP_LOGGER,
  LLM_PROVIDER,
  MARKET_FEED,
  ORCHESTRATOR,
  PROMPTS,
  RUNTIME_STATE,
  TELEGRAM_BOT,
} from '../tokens.ts';

/** Только сборка: LLM, промпты, оркестратор. Логики нет. */
@Module({
  imports: [MarketModule, TelegramModule],
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): LlmProvider => new LlmFactory(config).create(),
    },
    {
      provide: PROMPTS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Prompts => loadPrompts(config.promptsPath),
    },
    {
      provide: ORCHESTRATOR,
      inject: [APP_CONFIG, APP_LOGGER, LLM_PROVIDER, PROMPTS, TELEGRAM_BOT, MARKET_FEED, RUNTIME_STATE],
      useFactory: (
        config: AppConfig,
        log: Logger,
        llm: LlmProvider,
        prompts: Prompts,
        notifier: Notifier,
        feed: MarketFeed,
        state: RuntimeState,
      ): AnalysisOrchestrator =>
        new AnalysisOrchestrator({
          config,
          log,
          llm,
          prompts,
          notifier,
          state,
          ticker: () => feed.ticker(),
          priceNow: () => feed.priceNow(),
          now: () => Date.now(),
        }),
    },
  ],
  exports: [ORCHESTRATOR, LLM_PROVIDER, PROMPTS],
})
export class AiModule {}