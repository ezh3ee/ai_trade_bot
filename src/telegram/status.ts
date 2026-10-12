import type { ResponseMode } from '../ai/prompts.ts';

export interface StatusInfo {
  readonly symbol: string;
  readonly price: number | undefined;
  readonly priceTimeMs: number | undefined;
  readonly connected: boolean;
  readonly tradesTotal: number;
  readonly lastSignalAtMs: number | undefined;
  readonly lastDirection: string | undefined;
  readonly analysesToday: number;
  readonly dailyLimit: number;
  readonly paused: boolean;
  readonly mode: ResponseMode;
  readonly markPrice: number | undefined;
  readonly fundingRate: number | undefined;
}

function num(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}

function ago(timeMs: number | undefined, nowMs: number): string {
  if (timeMs === undefined) return '—';
  const seconds = Math.round((nowMs - timeMs) / 1000);
  if (seconds < 0) return 'только что';
  if (seconds < 60) return `${seconds} сек назад`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} мин назад`;
  return `${Math.round(seconds / 3600)} ч назад`;
}

export function formatStatus(info: StatusInfo, nowMs: number): string {
  const ws = info.connected ? '✓ на связи' : '✗ нет связи';
  const mode = info.paused ? '⏸ на паузе' : `работает, режим ${info.mode}`;

  return [
    `📡 ${info.symbol}`,
    `Биржа: ${ws}`,
    `Цена: ${num(info.price)} (обновление ${ago(info.priceTimeMs, nowMs)})`,
    `Mark price: ${num(info.markPrice)} · funding: ${num(info.fundingRate)}`,
    `Сделок принято: ${info.tradesTotal}`,
    `Последний сигнал: ${info.lastDirection ?? '—'} (${ago(info.lastSignalAtMs, nowMs)})`,
    `Анализов сегодня: ${info.analysesToday} из ${info.dailyLimit}`,
    `Состояние: ${mode}`,
  ].join('\n');
}

/** Компактная строка пульса — раз в минуту вместо мусора по каждой сделке. */
export function formatHeartbeat(options: {
  readonly symbol: string;
  readonly tradesTotal: number;
  readonly tradesInWindow: number;
  readonly windowMs: number;
  readonly price: number | undefined;
  readonly markPrice: number | undefined;
  readonly fundingRate: number | undefined;
  readonly connected: boolean;
  readonly ignored?: number;
}): string {
  const mark = options.connected ? '✓' : '✗';
  const perMinute = Math.round((options.tradesInWindow * 60_000) / options.windowMs);
  const parts = [
    `${mark} ${options.symbol}`,
    `сделок ${options.tradesTotal}`,
    `${perMinute}/мин`,
    `цена ${num(options.price)}`,
    `mark ${num(options.markPrice)}`,
    `funding ${options.fundingRate === undefined ? '—' : options.fundingRate.toFixed(6)}`,
  ];
  // Мусор показываем одной цифрой, а не строкой на каждое сообщение
  if (options.ignored !== undefined && options.ignored > 0) {
    parts.push(`пропущено ${options.ignored}`);
  }
  return parts.join(' · ');
}