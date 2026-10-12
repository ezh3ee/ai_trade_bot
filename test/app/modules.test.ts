import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/config.module.ts';
import { MarketModule, toTriggerEngineConfig } from '../../src/market/market.module.ts';
import { BybitModule } from '../../src/bybit/bybit.module.ts';
import { MarketStreamService } from '../../src/bybit/market-stream.service.ts';
import { AnalysisOrchestrator } from '../../src/app/orchestrator.ts';
import { loadPrompts } from '../../src/ai/prompts.ts';
import {
  APP_CONFIG,
  APP_LOGGER,
  ORCHESTRATOR,
  PROMPTS,
  TELEGRAM_SENDER,
  TRIGGER_ENGINE,
} from '../../src/tokens.ts';
import { TriggerEngine } from '../../src/market/trigger-engine.ts';
import type { AppConfig } from '../../src/config/schema.ts';
import { parseConfig } from '../../src/config/schema.ts';

const ENV = {
  TELEGRAM_BOT_TOKEN: '123:ABC',
  TELEGRAM_ADMIN_CHAT_ID: '-100123',
  LLM_BASE_URL: 'https://api.example.com/v1',
  LLM_API_KEY: 'sk-test',
  LLM_MODEL: 'test-model',
  LOG_LEVEL: 'error',
};

function configOf(patch: Record<string, string> = {}): AppConfig {
  return parseConfig({ ...ENV, ...patch });
}

describe('сборка Nest', () => {
  it('APP_CONFIG валидируется и доступен глобально', async () => {
    process.env.TELEGRAM_BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_ADMIN_CHAT_ID = ENV.TELEGRAM_ADMIN_CHAT_ID;
    process.env.LLM_BASE_URL = ENV.LLM_BASE_URL;
    process.env.LLM_API_KEY = ENV.LLM_API_KEY;
    process.env.LLM_MODEL = ENV.LLM_MODEL;
    process.env.LOG_LEVEL = 'error';

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile();

    const config = moduleRef.get<AppConfig>(APP_CONFIG);
    expect(config.telegram.botToken).toBe(ENV.TELEGRAM_BOT_TOKEN);
    expect(config.bybit.wsUrl).toContain('stream.bybit.com');
    expect(moduleRef.get(APP_LOGGER)).toBeDefined();
  });

  it('поднимает полный набор модулей и связывает зависимости', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, MarketModule, BybitModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(configOf())
      .overrideProvider(PROMPTS)
      .useValue(loadPrompts('./prompts.example.yml'))
      .compile();

    const engine = moduleRef.get(TRIGGER_ENGINE);
    expect(engine).toBeInstanceOf(TriggerEngine);
    expect(moduleRef.get(MarketStreamService)).toBeInstanceOf(MarketStreamService);
    expect(moduleRef.get(ORCHESTRATOR)).toBeInstanceOf(AnalysisOrchestrator);
    expect(moduleRef.get(TELEGRAM_SENDER)).toBeDefined();
  });

  it('при плохом .env приложение не поднимается с понятной ошибкой', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '';
    delete process.env.LLM_BASE_URL;

    await expect(
      Test.createTestingModule({ imports: [AppConfigModule] }).compile(),
    ).rejects.toThrow(/Конфигурация невалидна/);

    process.env.TELEGRAM_BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN;
    process.env.LLM_BASE_URL = ENV.LLM_BASE_URL;
  });
});

describe('перевод настроек в параметры движка', () => {
  it('пороги приходят из конфигурации, а не зашиты', () => {
    const config = configOf({
      SPIKE_PCT: '0.01',
      VOL_MULT: '5',
      WINDOW_MINUTES: '3',
      SPIKE_WINDOW_SECONDS: '30',
      COOLDOWN_MS: '5000',
      STALE_AFTER_MS: '3000',
    });

    const engineConfig = toTriggerEngineConfig(config);
    expect(engineConfig.spikeThreshold).toBe(0.01);
    expect(engineConfig.volumeMultiplier).toBe(5);
    expect(engineConfig.breakoutWindowMs).toBe(180_000);
    expect(engineConfig.maturityMs).toBe(30_000);
    expect(engineConfig.cooldownMs).toBe(5_000);
    expect(engineConfig.staleAfterMs).toBe(3_000);
    // окно памяти длиннее окна уровней, иначе нечего считать
    expect(engineConfig.retentionMs).toBeGreaterThan(engineConfig.breakoutWindowMs);
  });

  it('дефолты совпадают с §9 спецификации', () => {
    const engineConfig = toTriggerEngineConfig(configOf());
    expect(engineConfig.spikeThreshold).toBe(0.003);
    expect(engineConfig.volumeMultiplier).toBe(3);
    expect(engineConfig.maturityMs).toBe(60_000);
    expect(engineConfig.breakoutWindowMs).toBe(600_000);
    expect(engineConfig.cooldownMs).toBe(60_000);
  });
});
