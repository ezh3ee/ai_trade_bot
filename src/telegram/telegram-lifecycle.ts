import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TELEGRAM_BOT } from '../tokens.ts';
import type { TelegramBot } from './telegram-bot.ts';

/** Только жизненный цикл бота: запустить при старте, остановить при выходе. */
@Injectable()
export class TelegramLifecycleService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(TELEGRAM_BOT) private readonly bot: TelegramBot) {}

  onModuleInit(): void {
    void this.bot.start();
  }

  onModuleDestroy(): void {
    void this.bot.stop();
  }
}