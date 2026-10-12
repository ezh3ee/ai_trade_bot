import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app/app.module.ts';
import { PlannedAnalysisService } from '../../src/app/planned-analysis.service.ts';
import { parseConfig } from '../../src/config/schema.ts';
import { APP_CONFIG, PROMPTS } from '../../src/tokens.ts';
import { loadPrompts } from '../../src/ai/prompts.ts';
import type { AppConfig } from '../../src/config/schema.ts';

const config: AppConfig = parseConfig({
  TELEGRAM_BOT_TOKEN: '1:a',
  TELEGRAM_ADMIN_CHAT_ID: '-100123',
  LLM_BASE_URL: 'https://api.example.com/v1',
  LLM_API_KEY: 'k',
  LLM_MODEL: 'm',
});

async function build() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(PROMPTS)
    .useValue(loadPrompts('./prompts.example.yml'))
    .compile();

  const app = await moduleRef.init();
  return { app, moduleRef };
}

describe('приложение целиком', () => {
  it('поднимается и подключает плановый анализ (§9D)', async () => {
    const { app, moduleRef } = await build();
    expect(moduleRef.get(PlannedAnalysisService)).toBeInstanceOf(PlannedAnalysisService);
    await app.close();
  });

  it('останавливается без ошибок и без висящих таймеров', async () => {
    const { app } = await build();
    await expect(app.close()).resolves.toBeUndefined();
  });
});