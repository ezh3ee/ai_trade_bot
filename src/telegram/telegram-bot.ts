import { Bot } from 'grammy';
import type { Logger } from '../config/load.ts';
import { splitForTelegram } from './format.ts';
import { HELP_TEXT, isAllowedChat, parseCommand } from './commands.ts';
import { formatStatus } from './status.ts';
import type { StatusInfo } from './status.ts';
import type { ResponseMode } from '../ai/prompts.ts';

export type StatusProvider = () => StatusInfo;
export type ModeChangeHandler = (mode: ResponseMode) => void;
export type PauseChangeHandler = (paused: boolean) => void;

/**
 * Настоящий бот на grammY (§12).
 *
 * Три канала вывода, и это не одно и то же:
 *   notify      — важное: сигналы LONG/SHORT, обрыв биржи  -> Telegram
 *   reportError — ошибки, с ограничением частоты           -> Telegram
 *   logOnly     — WAIT, сработавшие триггеры, пульс       -> только консоль
 */
export interface Notifier {
  notify(text: string): Promise<void>;
  reportError(text: string): Promise<void>;
  logOnly(text: string): void;
}

export interface TelegramBotOptions {
  readonly token: string;
  readonly adminChatId: string;
  readonly dryRun: boolean;
  readonly log: Logger;
  readonly status: StatusProvider;
  readonly onModeChange: ModeChangeHandler;
  readonly onPauseChange: PauseChangeHandler;
  readonly now: () => number;
  /** Не чаще этого числа ошибок в час: иначе сломанный Telegram заспамит себя. */
  readonly errorLimitPerHour?: number;
}

const ERROR_WINDOW_MS = 3_600_000;

export class TelegramBot implements Notifier {
  private readonly bot: Bot;
  private readonly errorTimestamps: number[] = [];
  private readonly errorLimitPerHour: number;
  private running = false;

  constructor(private readonly options: TelegramBotOptions) {
    this.errorLimitPerHour = options.errorLimitPerHour ?? 3;
    this.bot = new Bot(options.token);
    this.registerHandlers();
  }

  // ─── команды ─────────────────────────────────────────────────

  private registerHandlers(): void {
    this.bot.on('message:text', async (ctx) => {
      const chatId = ctx.chat?.id;

      if (!isAllowedChat(chatId, this.options.adminChatId)) {
        this.options.log.warn('команда от чужого чата проигнорирована', { чат: String(chatId) });
        return;
      }

      const parsed = parseCommand(ctx.message.text);
      if (!parsed.ok) {
        await this.sendTo(String(chatId), parsed.reply);
        return;
      }

      const command = parsed.command;
      switch (command.name) {
        case 'status':
          await this.sendTo(String(chatId), formatStatus(this.options.status(), this.options.now()));
          return;
        case 'mode':
          this.options.onModeChange(command.mode);
          await this.sendTo(String(chatId), `Режим ответа: ${command.mode}`);
          return;
        case 'pause':
          this.options.onPauseChange(true);
          await this.sendTo(String(chatId), 'Пауза. Сигналы присыпать не буду.');
          return;
        case 'resume':
          this.options.onPauseChange(false);
          await this.sendTo(String(chatId), 'Снова работаю.');
          return;
        case 'help':
          await this.sendTo(String(chatId), HELP_TEXT);
          return;
      }
    });
  }

  // ─── жизненный цикл ──────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.options.log.info('Telegram: запускаю бота', {
      режим: this.options.dryRun ? 'DRY RUN, в Telegram не уходит' : 'обычный',
      чат: this.options.adminChatId,
    });

    try {
      // grammY сам переподключает long polling и переживает обрывы
      await this.bot.start({
        onStart: (info) => {
          this.options.log.info('Telegram: бот запущен', { имя: info.username });
        },
      });
    } catch (error: unknown) {
      this.running = false;
      this.options.log.error('Telegram: бот не запустился', { ошибка: String(error) });
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    try {
      await this.bot.stop();
      this.options.log.info('Telegram: бот остановлен');
    } catch (error: unknown) {
      this.options.log.warn('Telegram: ошибка при остановке', { ошибка: String(error) });
    }
  }

  // ─── каналы вывода ───────────────────────────────────────────

  /** Важное: сигналы и обрывы. */
  async notify(text: string): Promise<void> {
    if (this.options.dryRun) {
      this.printBox(text);
      return;
    }
    this.printBox(text);
    await this.sendTo(this.options.adminChatId, text);
  }

  /** Только консоль: WAIT, сработавшие триггеры, пульс. */
  logOnly(text: string): void {
    this.options.log.info(text);
  }

  async reportError(text: string): Promise<void> {
    this.options.log.error(text);
    if (this.options.dryRun) return;

    const nowMs = this.options.now();
    this.pruneErrors(nowMs);
    if (this.errorTimestamps.length >= this.errorLimitPerHour) {
      this.options.log.warn('Telegram: лимит ошибок в час исчерпан, молчу', {
        лимит: this.errorLimitPerHour,
      });
      return;
    }

    this.errorTimestamps.push(nowMs);
    try {
      await this.sendTo(this.options.adminChatId, `⚠️ ${text}`);
    } catch (sendError: unknown) {
      this.options.log.error('Telegram: не смог отправить ошибку', {
        ошибка: String(sendError),
      });
    }
  }

  private pruneErrors(nowMs: number): void {
    while (this.errorTimestamps.length > 0) {
      const oldest = this.errorTimestamps[0];
      if (oldest === undefined || nowMs - oldest < ERROR_WINDOW_MS) break;
      this.errorTimestamps.shift();
    }
  }

  private async sendTo(chatId: string, text: string): Promise<void> {
    for (const chunk of splitForTelegram(text)) {
      await this.bot.api.sendMessage(chatId, chunk, {
        link_preview_options: { is_disabled: true },
      });
    }
    this.options.log.debug('сообщение отправлено', { чат: chatId, символов: text.length });
  }

  /** Отправляемое сообщение печатается и в консоль — чтобы видеть без Телеграма. */
  private printBox(text: string): void {
    this.options.log.info(`\n${'─'.repeat(46)}\n${text}\n${'─'.repeat(46)}`);
  }
}