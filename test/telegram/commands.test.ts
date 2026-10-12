import { describe, expect, it } from 'vitest';
import { parseCommand, isAllowedChat, HELP_TEXT } from '../../src/telegram/commands.ts';
import { formatStatus, formatHeartbeat } from '../../src/telegram/status.ts';
import type { StatusInfo } from '../../src/telegram/status.ts';

const ADMIN = '-1001234567890';
const NOW = 1_700_000_040_000;

describe('разбор команд', () => {
  it.each([
    ['/status', 'status'],
    ['/STATUS', 'status'],
    ['/pause', 'pause'],
    ['/resume', 'resume'],
    ['/help', 'help'],
  ])('%s -> %s', (text, name) => {
    const parsed = parseCommand(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.command.name).toBe(name);
  });

  it('/mode expert и /mode beginner', () => {
    const a = parseCommand('/mode expert');
    const b = parseCommand('/mode beginner');
    expect(a.ok && a.command).toEqual({ name: 'mode', mode: 'expert' });
    expect(b.ok && b.command).toEqual({ name: 'mode', mode: 'beginner' });
  });

  it('/mode без аргумента -> понятная ошибка', () => {
    const parsed = parseCommand('/mode');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reply).toContain('/mode expert');
  });

  it('/mode hack -> отказ', () => {
    const parsed = parseCommand('/mode hacker');
    expect(parsed.ok).toBe(false);
  });

  it('команда с @имя_бота тоже работает', () => {
    const parsed = parseCommand('/status@my_trading_bot');
    expect(parsed.ok && parsed.command.name).toBe('status');
  });

  it('неизвестная команда -> подсказка, не тишина', () => {
    const parsed = parseCommand('/помощь');
    expect(parsed.ok && parsed.command.name).toBe('help');
  });

  it('обычный текст -> подсказка', () => {
    const parsed = parseCommand('привет');
    expect(parsed.ok && parsed.command.name).toBe('help');
  });

  it('пробелы не важны', () => {
    expect(parseCommand('  /status  ').ok).toBe(true);
  });
});

describe('доступ', () => {
  it('разрешён только чат из конфигурации', () => {
    expect(isAllowedChat(ADMIN, ADMIN)).toBe(true);
    expect(isAllowedChat('-1009999999999', ADMIN)).toBe(false);
    expect(isAllowedChat(123, ADMIN)).toBe(false);
  });

  it('без chat id доступа нет', () => {
    expect(isAllowedChat(undefined, ADMIN)).toBe(false);
  });

  it('@имя_канала сравнивается строкой', () => {
    expect(isAllowedChat('@my_channel', '@my_channel')).toBe(true);
    expect(isAllowedChat('@other', '@my_channel')).toBe(false);
  });
});

describe('/status', () => {
  const base: StatusInfo = {
    symbol: 'BTCUSDT',
    price: 83800,
    priceTimeMs: NOW - 5_000,
    connected: true,
    tradesTotal: 12_480,
    lastSignalAtMs: NOW - 120_000,
    lastDirection: 'LONG',
    analysesToday: 7,
    dailyLimit: 200,
    paused: false,
    mode: 'beginner',
    markPrice: 83801,
    fundingRate: 0.0001,
  };

  it('показывает состояние целиком', () => {
    const text = formatStatus(base, NOW);
    expect(text).toContain('BTCUSDT');
    expect(text).toContain('на связи');
    expect(text).toContain('83800');
    expect(text).toContain('LONG');
    expect(text).toContain('7 из 200');
    expect(text).toContain('beginner');
  });

  it('говорит сколько времени назад была цена', () => {
    expect(formatStatus(base, NOW)).toContain('5 сек назад');
    expect(formatStatus({ ...base, priceTimeMs: NOW - 600_000 }, NOW)).toContain('10 мин назад');
  });

  it('при обрыве биржи пишет об этом прямо', () => {
    expect(formatStatus({ ...base, connected: false }, NOW)).toContain('нет связи');
  });

  it('при паузе пишет об этом прямо', () => {
    expect(formatStatus({ ...base, paused: true }, NOW)).toContain('паузе');
  });

  it('при нулевых данных не падает и не врёт', () => {
    const text = formatStatus(
      {
        ...base,
        price: undefined,
        priceTimeMs: undefined,
        lastSignalAtMs: undefined,
        lastDirection: undefined,
        tradesTotal: 0,
        connected: false,
      },
      NOW,
    );
    expect(text).toContain('—');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
  });
});

describe('пульс', () => {
  it('одна строка, всё в ней по делу', () => {
    const line = formatHeartbeat({
      symbol: 'BTCUSDT',
      tradesTotal: 12_480,
      tradesInWindow: 208,
      windowMs: 60_000,
      price: 83800.5,
      markPrice: 83801,
      fundingRate: 0.0001,
      connected: true,
    });

    expect(line).toContain('✓ BTCUSDT');
    expect(line).toContain('сделок 12480');
    expect(line).toContain('208/мин');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('при обрыве помечает статус', () => {
    const line = formatHeartbeat({
      symbol: 'BTCUSDT',
      tradesTotal: 0,
      tradesInWindow: 0,
      windowMs: 60_000,
      price: undefined,
      markPrice: undefined,
      fundingRate: undefined,
      connected: false,
    });
    expect(line).toContain('✗');
  });
});

describe('подсказка', () => {
  it('перечисляет все команды', () => {
    expect(HELP_TEXT).toContain('/status');
    expect(HELP_TEXT).toContain('/mode');
    expect(HELP_TEXT).toContain('/pause');
    expect(HELP_TEXT).toContain('/resume');
  });
});