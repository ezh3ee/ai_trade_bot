import { z } from 'zod';

/**
 * Плоская схема .env -> валидированная конфигурация.
 *
 * Всё, что приходит извне, считается unknown и сужается через Zod.
 * Никаких обращений к process.env из бизнес-модулей (§4).
 */

/** z.coerce.number() превращает "" в 0 — это молчаливый баг. Отсекаем пустое. */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredText = z
  .string({ error: 'обязательное поле' })
  .trim()
  .min(1, 'не может быть пустым');

const numberFromEnv = (label: string) =>
  z.preprocess(blankToUndefined, z.coerce.number({ error: `${label} должно быть числом` }));

const positiveInt = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${label} должно быть числом` })
      .int(`${label} должно быть целым`)
      .positive(`${label} должно быть больше нуля`),
  );

const nonNegativeInt = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${label} должно быть числом` })
      .int(`${label} должно быть целым`)
      .min(0, `${label} не может быть отрицательным`),
  );

/** true/false/1/0/да/нет — всё, что люди реально пишут в .env. */
const boolFromEnv = (label: string) =>
  z.preprocess(blankToUndefined, z.enum(['true', 'false', '1', '0', 'yes', 'no', 'да', 'нет']).transform((value) => value === 'true' || value === '1' || value === 'yes' || value === 'да'));

/** BTCUSDT, ETHUSDT, BTCUSDT_25MAR25 и т.п. Только буквы, цифры, дефис, подчёркивание. */
const symbolSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{3,30}$/, 'не похоже на тикер Bybit, например BTCUSDT');

/** Числовой id чата (может быть отрицательным) либо @имя_канала. */
const chatIdSchema = z
  .string()
  .trim()
  .regex(/^(-?\d+|@[A-Za-z0-9_]{4,32})$/, 'ожидается числовой id или @имя_канала');

const urlSchema = z
  .string()
  .trim()
  .url('ожидается корректный URL, например https://api.example.com/v1');

/** Сырой .env — ровно то, что лежит в environment. */
export const rawEnvSchema = z.object({
  PORT: positiveInt('PORT').default(3000),

  TELEGRAM_BOT_TOKEN: requiredText,
  TELEGRAM_ADMIN_CHAT_ID: z.preprocess(blankToUndefined, chatIdSchema),
  TELEGRAM_DRY_RUN: boolFromEnv('TELEGRAM_DRY_RUN').default(false),

  LLM_BASE_URL: urlSchema,
  LLM_API_KEY: requiredText,
  LLM_MODEL: requiredText,
  LLM_MAX_RETRIES: nonNegativeInt('LLM_MAX_RETRIES').default(2),
  LLM_DAILY_LIMIT: positiveInt('LLM_DAILY_LIMIT').default(200),

  BYBIT_CATEGORY: z.enum(['linear', 'inverse', 'spot']).default('linear'),
  BYBIT_SYMBOL: z.preprocess(blankToUndefined, symbolSchema.default('BTCUSDT')),

  WINDOW_MINUTES: positiveInt('WINDOW_MINUTES').default(10),
  SPIKE_WINDOW_SECONDS: positiveInt('SPIKE_WINDOW_SECONDS').default(60),
  SPIKE_PCT: numberFromEnv('SPIKE_PCT').default(0.003),
  VOL_MULT: numberFromEnv('VOL_MULT').default(3),
  STALE_AFTER_MS: positiveInt('STALE_AFTER_MS').default(10_000),

  PLANNED_INTERVAL_MS: positiveInt('PLANNED_INTERVAL_MS').default(60_000),
  COOLDOWN_MS: nonNegativeInt('COOLDOWN_MS').default(60_000),

  PROMPTS_PATH: z.string().trim().min(1, 'не может быть пустым').default('./prompts.yml'),

  RESPONSE_MODE: z.enum(['expert', 'beginner']).default('beginner'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type RawEnv = z.infer<typeof rawEnvSchema>;

export interface AppConfig {
  readonly port: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly bybit: {
    readonly category: 'linear' | 'inverse' | 'spot';
    readonly symbol: string;
    readonly wsUrl: string;
  };
  readonly telegram: {
    readonly botToken: string;
    readonly adminChatId: string;
    /** Печатать сообщения в консоль вместо Telegram. Для проверки без VPN. */
    readonly dryRun: boolean;
  };
  readonly llm: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
    readonly maxRetries: number;
    readonly dailyLimit: number;
  };
  readonly triggers: {
    readonly windowMinutes: number;
    readonly spikeWindowSeconds: number;
    readonly spikePct: number;
    readonly volMult: number;
    readonly staleAfterMs: number;
  };
  readonly schedule: {
    readonly plannedIntervalMs: number;
    readonly cooldownMs: number;
  };
  readonly promptsPath: string;
  readonly responseMode: 'expert' | 'beginner';
}

const WS_URL_BY_CATEGORY: Record<RawEnv['BYBIT_CATEGORY'], string> = {
  linear: 'wss://stream.bybit.com/v5/public/linear',
  inverse: 'wss://stream.bybit.com/v5/public/inverse',
  spot: 'wss://stream.bybit.com/v5/public/spot',
};

export function toAppConfig(raw: RawEnv): AppConfig {
  return {
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    bybit: {
      category: raw.BYBIT_CATEGORY,
      symbol: raw.BYBIT_SYMBOL,
      wsUrl: WS_URL_BY_CATEGORY[raw.BYBIT_CATEGORY],
    },
    telegram: {
      botToken: raw.TELEGRAM_BOT_TOKEN,
      adminChatId: raw.TELEGRAM_ADMIN_CHAT_ID,
      dryRun: raw.TELEGRAM_DRY_RUN,
    },
    llm: {
      baseUrl: raw.LLM_BASE_URL,
      apiKey: raw.LLM_API_KEY,
      model: raw.LLM_MODEL,
      maxRetries: raw.LLM_MAX_RETRIES,
      dailyLimit: raw.LLM_DAILY_LIMIT,
    },
    triggers: {
      windowMinutes: raw.WINDOW_MINUTES,
      spikeWindowSeconds: raw.SPIKE_WINDOW_SECONDS,
      spikePct: raw.SPIKE_PCT,
      volMult: raw.VOL_MULT,
      staleAfterMs: raw.STALE_AFTER_MS,
    },
    schedule: {
      plannedIntervalMs: raw.PLANNED_INTERVAL_MS,
      cooldownMs: raw.COOLDOWN_MS,
    },
    promptsPath: raw.PROMPTS_PATH,
    responseMode: raw.RESPONSE_MODE,
  };
}

export class ConfigError extends Error {
  constructor(
    readonly issues: string[],
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** §4: отдельная функция форматирования ошибок валидации. */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(корень)';
    return `${path}: ${issue.message}`;
  });
}

export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  const result = rawEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = formatZodIssues(result.error);
    throw new ConfigError(
      issues,
      `Конфигурация невалидна:\n${issues.map((line) => `  - ${line}`).join('\n')}`,
    );
  }
  return toAppConfig(result.data);
}
