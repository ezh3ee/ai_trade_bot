import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/schema.ts';
import type { Logger } from '../config/load.ts';
import type { RuntimeState } from '../app/runtime-state.ts';
import { TelegramBot } from './telegram-bot.ts';
import { TelegramFeedService } from './status-feed.ts';
import { TelegramLifecycleService } from './telegram-lifecycle.ts';
import { MarketModule } from '../market/market.module.ts';
import {
  APP_CONFIG,
  APP_LOGGER,
  RUNTIME_STATE,
  TELEGRAM_BOT,
  TELEGRAM_FEED,
} from '../tokens.ts';

/**
 * Только сборка: перечисление providers и их связей. Логики здесь нет
 * и появляться не должна — она живёт в обычных классах рядом.
 */
@Module({
  imports: [MarketModule],
  providers: [
    {
      provide: TELEGRAM_FEED,
      inject: [APP_CONFIG, RUNTIME_STATE],
      useFactory: (config: AppConfig, state: RuntimeState): TelegramFeedService =>
        new TelegramFeedService(config, state),
    },
    {
      provide: TELEGRAM_BOT,
      inject: [APP_CONFIG, APP_LOGGER, TELEGRAM_FEED, RUNTIME_STATE],
      useFactory: (
        config: AppConfig,
        log: Logger,
        feed: TelegramFeedService,
        state: RuntimeState,
      ): TelegramBot =>
        new TelegramBot({
          token: config.telegram.botToken,
          adminChatId: config.telegram.adminChatId,
          dryRun: config.telegram.dryRun,
          log,
          status: () => feed.status(),
          onModeChange: (mode) => {
            state.setMode(mode);
            log.info('режим ответа изменён', { режим: mode });
          },
          onPauseChange: (paused) => {
            state.setPaused(paused);
          },
          now: () => Date.now(),
        }),
    },
    TelegramLifecycleService,
  ],
  exports: [TELEGRAM_BOT, TELEGRAM_FEED],
})
export class TelegramModule {}