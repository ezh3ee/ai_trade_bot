import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/schema.ts';
import type { Logger } from '../config/load.ts';
import { LlmFactory } from './factory.ts';
import { loadPrompts } from './prompts.ts';
import type { Prompts } from './prompts.ts';
import type { LlmProvider } from './provider.ts';
import type { MessageSender } from '../telegram/bot.ts';
import { createTelegramSender } from '../telegram/bot.ts';
import { AnalysisOrchestrator } from '../app/orchestrator.ts';
import type { MarketFeed } from '../market/market-feed.ts';
import { MarketModule } from '../market/market.module.ts';
import {
  APP_CONFIG,
  APP_LOGGER,
  LLM_PROVIDER,
  MARKET_FEED,
  ORCHESTRATOR,
  PROMPTS,
  TELEGRAM_SENDER,
} from '../tokens.ts';

/** Только сборка: LLM, промпты, Telegram, оркестратор. Логики нет. */
@Module({
  imports: [MarketModule],
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
      provide: TELEGRAM_SENDER,
      inject: [APP_CONFIG, APP_LOGGER],
      useFactory: (config: AppConfig, log: Logger): MessageSender =>
        createTelegramSender(config.telegram.botToken, log),
    },
    {
      provide: ORCHESTRATOR,
      inject: [APP_CONFIG, APP_LOGGER, LLM_PROVIDER, PROMPTS, TELEGRAM_SENDER, MARKET_FEED],
      useFactory: (
        config: AppConfig,
        log: Logger,
        llm: LlmProvider,
        prompts: Prompts,
        sender: MessageSender,
        feed: MarketFeed,
      ): AnalysisOrchestrator =>
        new AnalysisOrchestrator({
          config,
          log,
          llm,
          prompts,
          sender,
          ticker: () => feed.ticker(),
          priceNow: () => feed.priceNow(),
          now: () => Date.now(),
        }),
    },
  ],
  exports: [ORCHESTRATOR, LLM_PROVIDER, PROMPTS, TELEGRAM_SENDER],
})
export class AiModule {}