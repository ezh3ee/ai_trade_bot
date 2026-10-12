import { describe, expect, it } from 'vitest';
import { AnalysisOrchestrator } from '../../src/app/orchestrator.ts';
import { RuntimeState } from '../../src/app/runtime-state.ts';
import { MarketFeed } from '../../src/market/market-feed.ts';
import { loadPrompts } from '../../src/ai/prompts.ts';
import { parseConfig } from '../../src/config/schema.ts';
import type { AppConfig } from '../../src/config/schema.ts';
import type { Logger } from '../../src/config/load.ts';
import type { LlmProvider, GenerationResult } from '../../src/ai/provider.ts';
import { DEFAULT_OPTIONS } from '../../src/ai/provider.ts';
import type { TriggerEvent } from '../../src/market/trade.ts';
import type { Notifier } from '../../src/telegram/telegram-bot.ts';

const BASE = 1_700_000_040_000;
const GOOD_JSON =
  '{"direction":"LONG","confidence":70,"summary":"всё хорошо","entryPrice":83000,"risks":["риск"]}';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function config(patch: Record<string, string> = {}): AppConfig {
  return parseConfig({
    TELEGRAM_BOT_TOKEN: '1:a',
    TELEGRAM_ADMIN_CHAT_ID: '-100123',
    LLM_BASE_URL: 'https://api.example.com/v1',
    LLM_API_KEY: 'k',
    LLM_MODEL: 'm',
    COOLDOWN_MS: '60000',
    LLM_DAILY_LIMIT: '5',
    ...patch,
  });
}

interface Harness {
  readonly orchestrator: AnalysisOrchestrator;
  readonly sent: string[];
  readonly consoleOnly: string[];
  readonly errors: string[];
  readonly calls: string[];
  readonly feed: MarketFeed;
}

function make(options: {
  reply?: string;
  error?: boolean;
  config?: AppConfig;
  delayMs?: number;
} = {}): Harness {
  const calls: string[] = [];
  const feed = new MarketFeed('BTCUSDT', BASE);
  feed.applyTicker({ symbol: 'BTCUSDT', lastPrice: 83000, markPrice: 83001, indexPrice: 82999 }, BASE);
  feed.noteTrade({ id: 'a', timeMs: BASE, price: 83000, volume: 1 });

  let clock = BASE;
  const notified: string[] = [];
  const consoleOnly: string[] = [];
  const errors: string[] = [];

  const notifier: Notifier = {
    notify: async (text) => {
      notified.push(text);
    },
    reportError: async (text) => {
      errors.push(text);
    },
    logOnly: (text) => {
      consoleOnly.push(text);
    },
  };

  const llm: LlmProvider = {
    modelId: 'test',
    generate: async () => options.reply ?? GOOD_JSON,
    generateWithRetry: async (system, message): Promise<GenerationResult> => {
      calls.push(`${system}\n---USER---\n${message}`);
      if (options.delayMs !== undefined) {
        await new Promise((resolve) => { setTimeout(resolve, options.delayMs); });
        clock += options.delayMs;
      }
      if (options.error === true) throw new Error('LLM недоступен');
      return {
        text: options.reply ?? GOOD_JSON,
        modelId: 'test',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, elapsedMs: 1 },
      };
    },
  };

  const orchestrator = new AnalysisOrchestrator({
    config: options.config ?? config(),
    log: silent,
    llm,
    prompts: loadPrompts('./prompts.example.yml'),
    notifier,
    state: new RuntimeState((options.config ?? config()).responseMode),
    ticker: () => feed.ticker(),
    priceNow: () => feed.priceNow(),
    now: () => clock,
  });

  return { orchestrator, sent: notified, consoleOnly, errors, calls, feed };
}

const BREAKOUT: TriggerEvent = {
  kind: 'BREAKOUT',
  direction: 'UP',
  level: 82500,
  previousPrice: 82499,
  currentPrice: 82510,
  currentTimeMs: BASE,
};

describe('полная цепочка', () => {
  it('триггер -> промпт -> LLM -> Telegram', async () => {
    const h = make({ config: config({ RESPONSE_MODE: 'expert' }) });
    await h.orchestrator.onTrigger(BREAKOUT);

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toContain('опытный трейдер');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('LONG');
    expect(h.sent[0]).toContain('BTCUSDT');
  });

  it('ответ попадает в чат из конфигурации', async () => {
    const h = make();
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.sent[0]).toBeDefined();
  });

  it('режим из конфигурации меняет подачу', async () => {
    const h = make({ config: config({ RESPONSE_MODE: 'beginner' }) });
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.sent[0]).toContain('Что произошло');
  });

  it('тикер и цена подставляются в промпт', async () => {
    const h = make();
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.calls[0]).toContain('83000');
    expect(h.calls[0]).toContain('пробой уровня 82500');
  });

  it('в промпте не осталось незаполненных переменных', async () => {
    const h = make();
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.calls[0]).not.toContain('{{');
  });
});

describe('защита от лишних запросов', () => {
  it('кулдаун не даёт запустить второй анализ', async () => {
    const h = make();
    await h.orchestrator.onTrigger(BREAKOUT);
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.calls).toHaveLength(1);
  });

  it('не запускает параллельные запросы (§9 общая защита)', async () => {
    const h = make({ delayMs: 30 });
    const first = h.orchestrator.onTrigger(BREAKOUT);
    const second = h.orchestrator.onTrigger(BREAKOUT);
    await Promise.all([first, second]);
    expect(h.calls).toHaveLength(1);
  });

  it('дневной лимит останавливает запросы', async () => {
    const h = make({ config: config({ COOLDOWN_MS: '0', LLM_DAILY_LIMIT: '2' }) });
    await h.orchestrator.onTrigger(BREAKOUT);
    await h.orchestrator.onTrigger(BREAKOUT);
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.calls).toHaveLength(2);
  });
});

describe('разделение каналов', () => {
  it('LONG уходит в Telegram', async () => {
    const h = make();
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.sent).toHaveLength(1);
    expect(h.consoleOnly).toHaveLength(0);
  });

  it('WAIT в Telegram НЕ уходит, только в консоль', async () => {
    const h = make({ reply: '{"direction":"WAIT","confidence":10,"summary":"спокойно"}' });
    await h.orchestrator.onTrigger(BREAKOUT);

    expect(h.sent).toHaveLength(0);
    expect(h.consoleOnly).toHaveLength(1);
    expect(h.consoleOnly[0]).toContain('WAIT');
  });

  it('мусор от модели -> WAIT только в консоль', async () => {
    const h = make({ reply: 'не знаю' });
    await h.orchestrator.onTrigger(BREAKOUT);

    expect(h.sent).toHaveLength(0);
    expect(h.consoleOnly[0]).toContain('WAIT');
    expect(h.consoleOnly[0]).toContain('не разобран');
  });
});

describe('пауза и режим', () => {
  it('на паузе запросов к LLM нет', async () => {
    const h = make();
    h.orchestrator.pause();
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.calls).toHaveLength(0);
  });

  it('после resume запросы идут снова', async () => {
    const h = make();
    h.orchestrator.pause();
    h.orchestrator.resume();
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.calls).toHaveLength(1);
  });

  it('смена режима влияет на подачу', async () => {
    const h = make();
    h.orchestrator.setMode('beginner');
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.sent[0]).toContain('Что произошло');
  });
});

describe('ошибки', () => {
  it('падение LLM -> сообщение об ошибке, не тишина', async () => {
    const h = make({ error: true });
    await expect(h.orchestrator.onTrigger(BREAKOUT)).resolves.toBeUndefined();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toContain('не удался');
  });

  it('исчерпание дневного лимита сообщает об этом', async () => {
    const h = make({ config: config({ COOLDOWN_MS: '0', LLM_DAILY_LIMIT: '1' }) });
    await h.orchestrator.onTrigger(BREAKOUT);
    await h.orchestrator.onTrigger(BREAKOUT);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toContain('лимит');
  });
});