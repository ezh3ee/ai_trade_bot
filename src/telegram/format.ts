import type { MarketContext } from '../ai/context.ts';
import type { Signal } from '../ai/signal-schema.ts';
import type { ResponseMode } from '../ai/prompts.ts';

/**
 * Формат сообщения зависит от режима пользователя (§11).
 * Режим НЕ меняет расчёт триггеров и исходные данные — только подачу.
 */

const DIRECTION_EMOJI: Record<Signal['direction'], string> = {
  LONG: '🟢',
  SHORT: '🔴',
  WAIT: '⚪',
};

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value);
}

function header(context: MarketContext, signal: Signal): string {
  const dir = `${DIRECTION_EMOJI[signal.direction]} ${signal.direction}`;
  return [
    `${dir}  ·  уверенность ${signal.confidence}/100`,
    `${context.symbol} @ ${num(context.lastTradePrice)}`,
  ].join('\n');
}

function levels(signal: Signal): string {
  return [
    `Вход:    ${num(signal.entryPrice)}`,
    `Стоп:    ${num(signal.stopLoss)}`,
    `Тейк:    ${num(signal.takeProfit)}`,
  ].join('\n');
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `• ${item}`).join('\n');
}

function footer(context: MarketContext, stale: boolean): string {
  const stamp = context.capturedAt.replace('T', ' ').slice(0, 19);
  const staleNote = stale ? '\n⚠️ Ответ пришёл с опозданием, рынок уже мог измениться.' : '';
  return `Анализ: ${stamp} UTC · цена снимка ${num(context.lastTradePrice)}${staleNote}`;
}

export function formatExpert(context: MarketContext, signal: Signal, stale: boolean): string {
  const parts = [header(context, signal), '', signal.summary, '', levels(signal)];

  if (signal.invalidation !== undefined && signal.invalidation.length > 0) {
    parts.push('', `Отмена сценария: ${signal.invalidation}`);
  }
  if (signal.risks.length > 0) {
    parts.push('', 'Риски:', bullets(signal.risks));
  }

  parts.push('', '—', footer(context, stale), 'Анализ, не инвестиционный совет.');
  return parts.join('\n');
}

export function formatBeginner(context: MarketContext, signal: Signal, stale: boolean): string {
  const parts = [
    header(context, signal),
    '',
    `Что произошло: ${context.trigger.reason}`,
    '',
    signal.summary,
  ];

  if (signal.plainExplanation !== undefined && signal.plainExplanation.length > 0) {
    parts.push('', signal.plainExplanation);
  }

  parts.push('', levels(signal));

  const meaning: Record<Signal['direction'], string> = {
    LONG: 'LONG означает «ждать роста». SHORT — «ждать падения». WAIT — «не трогать, данных мало».',
    SHORT: 'LONG означает «ждать роста». SHORT — «ждать падения». WAIT — «не трогать, данных мало».',
    WAIT: 'WAIT — значит, торговать сейчас нечего. Это нормальный и частый ответ.',
  };
  parts.push('', meaning[signal.direction]);

  if (signal.risks.length > 0) parts.push('', 'Что может пойти не так:', bullets(signal.risks));
  if (signal.unknowns.length > 0) {
    parts.push('', 'Чего бот не знает:', bullets(signal.unknowns));
  }

  parts.push('', '—', footer(context, stale), 'Это объяснение для обучения, не совет и не сигнал к сделке.');
  return parts.join('\n');
}

export function formatSignal(
  mode: ResponseMode,
  context: MarketContext,
  signal: Signal,
  stale: boolean,
): string {
  return mode === 'expert'
    ? formatExpert(context, signal, stale)
    : formatBeginner(context, signal, stale);
}

/** Telegram не примет сообщение длиннее 4096 символов. */
export const TELEGRAM_LIMIT = 4096;

export function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_LIMIT) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > TELEGRAM_LIMIT) {
    let cut = rest.lastIndexOf('\n', TELEGRAM_LIMIT - 1);
    // cut указывает НА перевод строки, режем сразу после него,
    // иначе склейка кусков обратно потеряет переводы.
    cut = cut < TELEGRAM_LIMIT * 0.5 ? TELEGRAM_LIMIT : cut + 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}