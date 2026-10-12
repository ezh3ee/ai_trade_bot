import { describe, expect, it } from 'vitest';
import { ConfigError, formatZodIssues, parseConfig, rawEnvSchema } from '../../src/config/schema.ts';

const VALID = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
  TELEGRAM_ADMIN_CHAT_ID: '-1001234567890',
  LLM_BASE_URL: 'https://api.example.com/v1',
  LLM_API_KEY: 'sk-secret',
  LLM_MODEL: 'some-model',
};

describe('валидация конфигурации', () => {
  it('принимает минимальный набор и подставляет дефолты', () => {
    const config = parseConfig(VALID);

    expect(config.port).toBe(3000);
    expect(config.bybit.symbol).toBe('BTCUSDT');
    expect(config.bybit.category).toBe('linear');
    expect(config.bybit.wsUrl).toBe('wss://stream.bybit.com/v5/public/linear');
    expect(config.triggers.spikePct).toBe(0.003);
    expect(config.triggers.volMult).toBe(3);
    expect(config.triggers.windowMinutes).toBe(10);
    expect(config.schedule.cooldownMs).toBe(60_000);
    expect(config.responseMode).toBe('beginner');
    expect(config.promptsPath).toBe('./prompts.yml');
    expect(config.llm.dailyLimit).toBe(200);
  });

  it('wsUrl строится под категорию рынка', () => {
    expect(parseConfig({ ...VALID, BYBIT_CATEGORY: 'inverse' }).bybit.wsUrl).toBe(
      'wss://stream.bybit.com/v5/public/inverse',
    );
    expect(parseConfig({ ...VALID, BYBIT_CATEGORY: 'spot' }).bybit.wsUrl).toBe(
      'wss://stream.bybit.com/v5/public/spot',
    );
  });

  it('тикер приходит из конфигурации, а не зашит в коде', () => {
    expect(parseConfig({ ...VALID, BYBIT_SYMBOL: 'ETHUSDT' }).bybit.symbol).toBe('ETHUSDT');
  });

  it.each([
    ['пустой TELEGRAM_BOT_TOKEN', { TELEGRAM_BOT_TOKEN: '' }],
    ['пустой LLM_API_KEY', { LLM_API_KEY: '' }],
    ['пустой LLM_MODEL', { LLM_MODEL: '' }],
    ['нечисловой PORT', { PORT: 'abc' }],
    ['дробный PORT', { PORT: '3.5' }],
    ['отрицательный PORT', { PORT: '-1' }],
    ['кривой baseUrl', { LLM_BASE_URL: 'не-урл' }],
    ['кривой тикер', { BYBIT_SYMBOL: 'btc usdt!' }],
    ['кривой chat id', { TELEGRAM_ADMIN_CHAT_ID: 'вот' }],
    ['неизвестный режим', { RESPONSE_MODE: 'hacker' }],
    ['неизвестный уровень лога', { LOG_LEVEL: 'verbose' }],
  ])('отклоняет: %s', (_label, patch) => {
    expect(() => parseConfig({ ...VALID, ...patch })).toThrow(ConfigError);
  });

  it('пустая строка не превращается в ноль', () => {
    // Главный баг coerce: "" -> 0 -> тихо едет дальше
    expect(() => parseConfig({ ...VALID, PORT: '' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...VALID, SPIKE_PCT: '' })).toThrow(ConfigError);
  });

  it('сообщение об ошибке перечисляет конкретные поля', () => {
    try {
      parseConfig({ ...VALID, LLM_BASE_URL: 'мусор', PORT: 'нет' });
      throw new Error('должен был упасть');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('PORT');
      expect(message).toContain('LLM_BASE_URL');
      expect(message).toContain('Конфигурация невалидна');
    }
  });

  it('formatZodIssues читаем', () => {
    const result = rawEnvSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = formatZodIssues(result.error);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain('TELEGRAM_BOT_TOKEN');
  });

  it('принимает @имя_канала вместо числового id', () => {
    expect(parseConfig({ ...VALID, TELEGRAM_ADMIN_CHAT_ID: '@my_signal_bot' }).telegram.adminChatId).toBe(
      '@my_signal_bot',
    );
  });

  it('не течёт секреты в текст ошибки', () => {
    try {
      parseConfig({ ...VALID, PORT: 'нет', LLM_API_KEY: 'sk-super-secret-value' });
      throw new Error('должен был упасть');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain('sk-super-secret-value');
    }
  });
});
