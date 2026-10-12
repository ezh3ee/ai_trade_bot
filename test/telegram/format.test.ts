import { describe, expect, it } from 'vitest';
import { formatExpert, formatBeginner, formatSignal, splitForTelegram, TELEGRAM_LIMIT } from '../../src/telegram/format.ts';
import { buildMarketContext, EMPTY_POSITION } from '../../src/ai/context.ts';
import { TickerState } from '../../src/bybit/ticker.ts';
import { WAIT_SIGNAL } from '../../src/ai/signal-schema.ts';
import type { Signal } from '../../src/ai/signal-schema.ts';
import type { TriggerEvent } from '../../src/market/trade.ts';

const BASE = 1_700_000_040_000;

function contextFor(event: TriggerEvent) {
  const ticker = new TickerState('BTCUSDT', BASE);
  ticker.merge(
    { symbol: 'BTCUSDT', lastPrice: 83000, markPrice: 83001, indexPrice: 82999, fundingRate: 0.0001 },
    BASE,
  );
  return buildMarketContext({
    symbol: 'BTCUSDT',
    category: 'linear',
    nowMs: BASE,
    lastTradePrice: 83000,
    lastTradeAtMs: BASE,
    ticker: ticker.get(),
    trigger: event,
    position: EMPTY_POSITION,
  });
}

const BREAKOUT: TriggerEvent = {
  kind: 'BREAKOUT',
  direction: 'UP',
  level: 82500,
  previousPrice: 82499,
  currentPrice: 82510,
  currentTimeMs: BASE,
};

const LONG: Signal = {
  direction: 'LONG',
  confidence: 70,
  summary: 'Пробой подтверждён объёмом',
  plainExplanation: 'Цена вышла из диапазона вверх',
  entryPrice: 82510,
  stopLoss: 82200,
  takeProfit: 83500,
  risks: ['откат к уровню', 'thin book'],
  unknowns: ['нет свечной истории'],
  invalidation: 'закрытие свечи ниже 82500',
};

describe('формат для эксперта', () => {
  const context = contextFor(BREAKOUT);
  const text = formatExpert(context, LONG, false);

  it('коротко: направление, уровни, риски', () => {
    expect(text).toContain('LONG');
    expect(text).toContain('82510');
    expect(text).toContain('82200');
    expect(text).toContain('83500');
    expect(text).toContain('Риски');
    expect(text).toContain('закрытие свечи ниже 82500');
  });

  it('указывает время анализа и цену снимка (§11)', () => {
    expect(text).toContain('2023-11-14');
    expect(text).toContain('83000');
  });

  it('не выдаёт себя за сигнал к сделке', () => {
    expect(text).toContain('не инвестиционный совет');
  });

  it('отсутствующие уровни печатаются прочерком', () => {
    const bare = formatExpert(context, { ...LONG, entryPrice: null, stopLoss: null }, false);
    expect(bare).toContain('Вход:    —');
  });
});

describe('формат для новичка', () => {
  const context = contextFor(BREAKOUT);
  const text = formatBeginner(context, LONG, false);

  it('объясняет простыми словами', () => {
    expect(text).toContain('Что произошло');
    expect(text).toContain('Цена вышла из диапазона вверх');
    expect(text).toContain('LONG');
  });

  it('объясняет значения LONG/SHORT/WAIT', () => {
    expect(formatBeginner(context, LONG, false)).toContain('LONG означает');
    expect(formatBeginner(context, WAIT_SIGNAL, false)).toContain('WAIT');
  });

  it('говорит каких данных не хватает', () => {
    expect(text).toContain('Чего бот не знает');
    expect(text).toContain('нет свечной истории');
  });

  it('не выдаёт себя за совет', () => {
    expect(text).toContain('не совет');
  });
});

describe('устаревший ответ', () => {
  const context = contextFor(BREAKOUT);

  it('помечается в обоих режимах (§10)', () => {
    expect(formatExpert(context, LONG, true)).toContain('опозданием');
    expect(formatBeginner(context, LONG, true)).toContain('опозданием');
  });

  it('без устаревания пометки нет', () => {
    expect(formatExpert(context, LONG, false)).not.toContain('опозданием');
  });
});

describe('выбор формата', () => {
  const context = contextFor(BREAKOUT);

  it('режим выбирает формат, а не данные', () => {
    expect(formatSignal('expert', context, LONG, false)).toBe(formatExpert(context, LONG, false));
    expect(formatSignal('beginner', context, LONG, false)).toBe(formatBeginner(context, LONG, false));
  });

  it('оба формата содержат цену и время', () => {
    expect(formatSignal('expert', context, LONG, false)).toContain('83000');
    expect(formatSignal('beginner', context, LONG, false)).toContain('83000');
  });
});

describe('разбивка длинных сообщений', () => {
  it('короткое сообщение не трогается', () => {
    expect(splitForTelegram('привет')).toEqual(['привет']);
  });

  it('длинное режется по границам строк', () => {
    const long = Array.from({ length: 500 }, (_, i) => `строка номер ${i}`).join('\n');
    const chunks = splitForTelegram(long);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(chunks.join('')).toBe(long);
  });
});