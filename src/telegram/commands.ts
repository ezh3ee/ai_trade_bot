/**
 * Разбор команд и проверка доступа (§12).
 *
 * Чистые функции без сети: grammY подставляется сверху, логика проверяется
 * обычными тестами.
 */

export type Command =
  | { readonly name: 'status' }
  | { readonly name: 'mode'; readonly mode: 'expert' | 'beginner' }
  | { readonly name: 'pause' }
  | { readonly name: 'resume' }
  | { readonly name: 'help' };

export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly reply: string };

export const HELP_TEXT = [
  'Команды:',
  '/status — состояние бота, цена и время последнего сигнала',
  '/mode expert — короткий разбор',
  '/mode beginner — подробное объяснение',
  '/pause — перестать присылать сигналы',
  '/resume — снова присылать',
].join('\n');

/**
 * Чат разрешён, только если он совпадает с TELEGRAM_ADMIN_CHAT_ID.
 * Никто больше не может ни читать состояние, ни что-то менять (§12).
 */
export function isAllowedChat(chatId: string | number | undefined, allowed: string): boolean {
  if (chatId === undefined) return false;
  return String(chatId) === allowed;
}

export function parseCommand(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return { ok: true, command: { name: 'help' } };
  }

  const [rawName = '', ...args] = trimmed.split(/\s+/);
  const name = rawName.split('@')[0]?.toLowerCase() ?? '';

  switch (name) {
    case '/status':
      return { ok: true, command: { name: 'status' } };
    case '/help':
      return { ok: true, command: { name: 'help' } };
    case '/pause':
      return { ok: true, command: { name: 'pause' } };
    case '/resume':
      return { ok: true, command: { name: 'resume' } };
    case '/mode': {
      const mode = (args[0] ?? '').toLowerCase();
      if (mode !== 'expert' && mode !== 'beginner') {
        return { ok: false, reply: 'Нужно /mode expert или /mode beginner' };
      }
      return { ok: true, command: { name: 'mode', mode } };
    }
    default:
      return { ok: true, command: { name: 'help' } };
  }
}