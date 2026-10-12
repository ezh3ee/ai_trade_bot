import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.ts';
import { loadConfig, createLogger } from './config/load.ts';

/**
 * Точка входа.
 *
 * Конфигурация читается и проверяется ДО создания приложения: если .env
 * кривой, Nest даже не поднимется, а пользователь увидит список полей (§4).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  log.info('запускаю приложение', {
    символ: config.bybit.symbol,
    биржа: config.bybit.category,
    режим: config.responseMode,
    llm: `${config.llm.model} @ ${config.llm.baseUrl}`,
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();

  await app.listen(config.port);
  log.info('приложение поднято', { порт: config.port });

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`получен ${signal}, останавливаюсь`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
