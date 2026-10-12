import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { AppConfig } from './schema.ts';
import { createLogger, loadConfig } from './load.ts';
import { APP_CONFIG, APP_LOGGER } from '../tokens.ts';

/**
 * Конфигурация валидируется при старте приложения (§4).
 *
 * ConfigModule читает .env, а APP_CONFIG — это уже проверенный объект
 * с типизированными полями. Бизнес-модули не видят process.env (§4).
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
    {
      provide: APP_LOGGER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createLogger(config.logLevel),
    },
  ],
  exports: [APP_CONFIG, APP_LOGGER],
})
export class AppConfigModule {}
