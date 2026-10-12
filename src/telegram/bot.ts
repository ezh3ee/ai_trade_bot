import type { Logger } from '../config/load.ts';
import { splitForTelegram } from './format.ts';

/**
 * Отправка в Telegram. Интерфейс узкий намеренно: пока он умеет только
 * отправлять, его невозможно случайно использовать для чего-то ещё.
 *
 * Проверка доступа живёт в оркестраторе: чат назначается из конфигурации,
 * а не берётся из входящего сообщения (§12).
 */
export interface MessageSender {
  send(chatId: string, text: string): Promise<void>;
}

/** Реальная отправка через grammY. */
export function createTelegramSender(token: string, log: Logger): MessageSender {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  return {
    async send(chatId: string, text: string): Promise<void> {
      for (const chunk of splitForTelegram(text)) {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Telegram ${response.status}: ${body.slice(0, 300)}`);
        }
        log.debug('сообщение отправлено', { chatId, символов: chunk.length });
      }
    },
  };
}