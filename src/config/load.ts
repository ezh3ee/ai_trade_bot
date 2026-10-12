import type { AppConfig } from './schema.ts';
import { ConfigError, parseConfig } from './schema.ts';

/**
 * Загрузка конфигурации. Единственное место, где живёт process.env (§4).
 */

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  return parseConfig(source);
}

export { ConfigError };

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVEL_ORDER;

/** Подробный лог: время, уровень, сообщение, структурные поля. §14. */
export function createLogger(level: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[level];

  const write = (
    line: (msg: string) => string,
    name: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (LEVEL_ORDER[name] < threshold) return;
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const extras = meta === undefined ? '' : ` ${JSON.stringify(meta)}`;
    console.log(`${stamp} ${line(name)} ${message}${extras}`);
  };

  return {
    debug: (message, meta) => write((n) => n.toUpperCase().padEnd(5), 'debug', message, meta),
    info: (message, meta) => write((n) => n.toUpperCase().padEnd(5), 'info', message, meta),
    warn: (message, meta) => write((n) => n.toUpperCase().padEnd(5), 'warn', message, meta),
    error: (message, meta) => write((n) => n.toUpperCase().padEnd(5), 'error', message, meta),
  };
}

/** Секреты не должны попадать в логи (§4). */
export const REDACTED = '***';

export function redact(value: string): string {
  return value.length <= 8 ? REDACTED : `${value.slice(0, 4)}…${REDACTED}`;
}
