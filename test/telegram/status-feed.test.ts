import { describe, expect, it } from 'vitest';
import { TelegramFeedService } from '../../src/telegram/status-feed.ts';
import { RuntimeState } from '../../src/app/runtime-state.ts';
import { parseConfig } from '../../src/config/schema.ts';
import type { AppConfig } from '../../src/config/schema.ts';

const BASE = 1_700_000_040_000;

function config(patch: Record<string, string> = {}): AppConfig {
  return parseConfig({
    TELEGRAM_BOT_TOKEN: '1:a',
    TELEGRAM_ADMIN_CHAT_ID: '-100123',
    LLM_BASE_URL: 'https://api.example.com/v1',
    LLM_API_KEY: 'k',
    LLM_MODEL: 'm',
    LLM_DAILY_LIMIT: '50',
    RESPONSE_MODE: 'beginner',
    ...patch,
  });
}

function make(patch: Record<string, string> = {}) {
  const state = new RuntimeState(config(patch).responseMode);
  return { state, feed: new TelegramFeedService(config(patch), state) };
}

describe('данные для /status', () => {
  it('начинает с пустого состояния без выдумок', () => {
    const { feed } = make();
    const info = feed.status();

    expect(info.symbol).toBe('BTCUSDT');
    expect(info.connected).toBe(false);
    expect(info.tradesTotal).toBe(0);
    expect(info.price).toBeUndefined();
    expect(info.lastDirection).toBeUndefined();
  });

  it('накапливает то, что пришло с биржи', () => {
    const { feed } = make();

    feed.setConnected(true);
    feed.setTrades(12_480);
    feed.setPrice(83_800.5, BASE);
    feed.setTicker(83_801, 0.0001);

    const info = feed.status();
    expect(info.connected).toBe(true);
    expect(info.tradesTotal).toBe(12_480);
    expect(info.price).toBe(83_800.5);
    expect(info.priceTimeMs).toBe(BASE);
    expect(info.markPrice).toBe(83_801);
    expect(info.fundingRate).toBe(0.0001);
  });

  it('берёт режим, паузу и сигнал из общего состояния', () => {
    const { feed, state } = make();

    state.setMode('expert');
    state.setPaused(true);
    state.setSignal('LONG', BASE);

    const info = feed.status();
    expect(info.mode).toBe('expert');
    expect(info.paused).toBe(true);
    expect(info.lastDirection).toBe('LONG');
    expect(info.lastSignalAtMs).toBe(BASE);
  });

  it('счётчик анализов берётся из состояния и сбрасывается на новые сутки', () => {
    const { feed, state } = make();

    expect(state.takeDailySlot(BASE, 2)).toBe(true);
    expect(state.takeDailySlot(BASE + 1000, 2)).toBe(true);
    expect(state.takeDailySlot(BASE + 2000, 2)).toBe(false);
    expect(feed.status().analysesToday).toBe(2);

    // следующие сутки
    const nextDay = Date.parse('2023-11-15T10:00:00.000Z');
    expect(state.takeDailySlot(nextDay, 2)).toBe(true);
    expect(feed.status().analysesToday).toBe(1);
  });

  it('лимит в статусе берётся из конфигурации', () => {
    const { feed } = make({ LLM_DAILY_LIMIT: '7' });
    expect(feed.status().dailyLimit).toBe(7);
  });

  it('тикер без mark price не ломает статус', () => {
    const { feed } = make();
    feed.setTicker(undefined, undefined);
    feed.setPrice(undefined, undefined);

    const info = feed.status();
    expect(info.markPrice).toBeUndefined();
    expect(info.price).toBeUndefined();
  });
});