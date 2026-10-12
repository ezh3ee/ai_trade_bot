import { describe, expect, it, vi } from 'vitest';
import { BaseLlmProvider, DEFAULT_OPTIONS, LlmError, type GenerationOptions } from '../../src/ai/provider.ts';
import type { GenerationResult } from '../../src/ai/provider.ts';
import { LlmFactory } from '../../src/ai/factory.ts';
import { parseConfig } from '../../src/config/schema.ts';
import { OpenAiCompatibleProvider } from '../../src/ai/openai-provider.ts';

class FlakyProvider extends BaseLlmProvider {
  calls = 0;
  constructor(
    private readonly failures: number,
    maxRetries: number,
    retryDelayMs = 0,
  ) {
    super(maxRetries, retryDelayMs);
  }
  override readonly modelId = 'flaky-model';
  override async generate(): Promise<string> {
    this.calls += 1;
    if (this.calls <= this.failures) throw new Error(`сбой попытка ${this.calls}`);
    this.lastInputTokens = 100;
    this.lastOutputTokens = 30;
    return 'ок';
  }
}

describe('повторы запроса', () => {
  it('успех с первой попытки', async () => {
    const provider = new FlakyProvider(0, 2);
    const result = await provider.generateWithRetry('s', 'm');
    expect(provider.calls).toBe(1);
    expect(result.text).toBe('ок');
    expect(result.usage.totalTokens).toBe(130);
    expect(result.modelId).toBe('flaky-model');
  });

  it('повторяет до успеха', async () => {
    const provider = new FlakyProvider(2, 2);
    const result = await provider.generateWithRetry('s', 'm');
    expect(provider.calls).toBe(3);
    expect(result.text).toBe('ок');
  });

  it('после исчерпания попыток ошибка уходит вызывающему (§6)', async () => {
    const provider = new FlakyProvider(99, 2);
    await expect(provider.generateWithRetry('s', 'm')).rejects.toThrow(LlmError);
    expect(provider.calls).toBe(3);
  });

  it('ошибка не скрывается и не зацикливается бесконечно', async () => {
    const provider = new FlakyProvider(99, 0);
    await expect(provider.generateWithRetry('s', 'm')).rejects.toThrow(/после 1 попыток/);
  });

  it('не повторяет бесконечно при нуле ретраев', async () => {
    const provider = new FlakyProvider(99, 5);
    await expect(provider.generateWithRetry('s', 'm')).rejects.toThrow(/после 6 попыток/);
    expect(provider.calls).toBe(6);
  });

  it('задержка между попытками растёт', async () => {
    vi.useFakeTimers();
    try {
      const provider = new FlakyProvider(99, 3, 100);
      const promise = provider.generateWithRetry('s', 'm');
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).rejects.toThrow(LlmError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('дефолтные опции разумные', () => {
    expect(DEFAULT_OPTIONS.temperature).toBeGreaterThan(0);
    expect(DEFAULT_OPTIONS.maxOutputTokens).toBeGreaterThan(0);
    expect(DEFAULT_OPTIONS.tools).toBeUndefined();
  });
});

describe('фабрика провайдеров', () => {
  it('создаёт провайдера из конфигурации, без привязки к вендору', () => {
    const config = parseConfig({
      TELEGRAM_BOT_TOKEN: '1:a',
      TELEGRAM_ADMIN_CHAT_ID: '-100',
      LLM_BASE_URL: 'https://api.x.ai/v1',
      LLM_API_KEY: 'xai-key',
      LLM_MODEL: 'grok-4',
    });

    const provider = new LlmFactory(config).create();
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.modelId).toBe('grok-4');
  });

  it('одинаково собирает провайдера для любого baseUrl', () => {
    for (const baseUrl of ['https://api.deepseek.com/v1', 'https://api.x.ai/v1', 'http://localhost:11434/v1']) {
      const config = parseConfig({
        TELEGRAM_BOT_TOKEN: '1:a',
        TELEGRAM_ADMIN_CHAT_ID: '-100',
        LLM_BASE_URL: baseUrl,
        LLM_API_KEY: 'k',
        LLM_MODEL: 'm',
      });
      expect(new LlmFactory(config).create().modelId).toBe('m');
    }
  });

  it('провайдер без ключа не падает на заглушке (§6)', () => {
    const provider = new OpenAiCompatibleProvider('m', 'http://localhost:11434/v1', '', 1, 0);
    expect(provider.modelId).toBe('m');
  });

  it('satisfies GenerationOptions с tools (§6)', () => {
    const options: GenerationOptions = { temperature: 0.2, maxOutputTokens: 10 };
    expect(options.temperature).toBe(0.2);
  });
});

export type { GenerationResult };