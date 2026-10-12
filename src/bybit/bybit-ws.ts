import type { Trade } from '../market/trade.ts';
import type { Logger } from '../config/load.ts';
import { parseWsMessage, tradeTopic } from './schema.ts';
import { parseTickerMessage, tickerTopic } from './ticker.ts';
import type { TickerData } from './ticker.ts';

/**
 * Вебсокет Bybit: подписка, heartbeat, переподключение.
 *
 * Сокет создаётся через внедряемую фабрику — поэтому клиент полностью
 * тестируется без сети. Реальный WebSocket подставляется в main.ts.
 */

export interface WsHandle {
  send(data: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (code: number, reason: string) => void): void;
  onError(handler: (error: unknown) => void): void;
}

export function createBrowserWsHandle(url: string): WsHandle {
  const socket = new WebSocket(url);
  const open: (() => void)[] = [];
  const message: ((data: string) => void)[] = [];
  const close: ((code: number, reason: string) => void)[] = [];
  const error: ((err: unknown) => void)[] = [];

  socket.addEventListener('open', () => {
    for (const handler of open) handler();
  });
  socket.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== 'string') return;
    for (const handler of message) handler(data);
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    for (const handler of close) handler(event.code, event.reason);
  });
  socket.addEventListener('error', () => {
    for (const handler of error) handler(new Error('websocket error'));
  });

  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onOpen: (handler) => open.push(handler),
    onMessage: (handler) => message.push(handler),
    onClose: (handler) => close.push(handler),
    onError: (handler) => error.push(handler),
  };
}

export interface BybitWsOptions {
  readonly url: string;
  readonly symbol: string;
  readonly onTrades: (trades: readonly Trade[]) => void;
  readonly onReset: (reason: string) => void;
  readonly onTicker: (update: TickerData) => void;
  readonly onConnected: () => void;
  readonly onDisconnected: () => void;
  readonly log: Logger;
  readonly connect: (url: string) => WsHandle;
  readonly pingIntervalMs?: number;
  readonly silenceTimeoutMs?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Разрыв в данных больше этого = окно надо прогреть заново. */
  readonly maxGapMs?: number;
}

const DEFAULT_PING_MS = 20_000;
const DEFAULT_SILENCE_MS = 30_000;
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_MAX_GAP_MS = 10_000;

export class BybitWsClient {
  private readonly pingIntervalMs: number;
  private readonly silenceTimeoutMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxGapMs: number;

  private socket: WsHandle | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private stopped = true;
  private lastTradeTimeMs: number | undefined;
  private readonly ignoredReasons = new Map<string, number>();
  private readonly seenReasons = new Set<string>();

  constructor(private readonly options: BybitWsOptions) {
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_MS;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? DEFAULT_SILENCE_MS;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.options.onDisconnected();
  }

  private openSocket(): void {
    if (this.stopped) return;

    const socket = this.options.connect(this.options.url);
    this.socket = socket;

    socket.onOpen(() => {
      this.attempt = 0;
      this.options.onConnected();
      this.options.log.info('ws: подключились', { url: this.options.url });
      socket.send(
        JSON.stringify({
          op: 'subscribe',
          args: [tradeTopic(this.options.symbol), tickerTopic(this.options.symbol)],
        }),
      );
      this.startPing();
    });

    socket.onMessage((data) => {
      this.handleMessage(data);
    });

    socket.onClose((code, reason) => {
      this.options.onDisconnected();
      this.options.log.warn('ws: соединение закрыто', { code, reason });
      this.scheduleReconnect();
    });

    socket.onError((error: unknown) => {
      this.options.log.error('ws: ошибка сокета', { error: String(error) });
    });

    this.armSilenceWatchdog();
  }

  private handleMessage(data: string): void {
    this.armSilenceWatchdog();

    const ticker = parseTickerMessage(data);
    if (ticker !== undefined) {
      if (ticker.topic === tickerTopic(this.options.symbol)) {
        this.options.onTicker(ticker.data);
      }
      return;
    }

    const message = parseWsMessage(data);
    switch (message.kind) {
      case 'trades': {
        if (message.topic !== tradeTopic(this.options.symbol)) {
          this.noteIgnored(message.topic);
          return;
        }
        this.emitTrades(message.trades);
        return;
      }
      case 'pong':
        this.options.log.debug('ws: pong');
        return;
      case 'subscribed':
        this.options.log.info('ws: подписка принята', { connId: message.connId });
        return;
      case 'failed':
        this.options.log.error('ws: подписка отклонена', { message: message.message });
        return;
      case 'ignored':
        this.noteIgnored(message.reason);
    }
  }

  private emitTrades(trades: readonly Trade[]): void {
    const last = this.lastTradeTimeMs;
    const newest = trades[trades.length - 1];

    if (last !== undefined && newest !== undefined && newest.timeMs - last > this.maxGapMs) {
      const gapMs = newest.timeMs - last;
      this.options.log.warn('ws: разрыв в данных, окно перезапускается', { gapMs });
      this.options.onReset(`разрыв ${gapMs} мс`);
    }

if (newest !== undefined) this.lastTradeTimeMs = newest.timeMs;
    if (trades.length === 0) return;

    // Никакого логирования каждой сделки: это сотни строк в секунду.
    // Количество и цена показываются в пульсе раз в минуту (§14).
    this.options.onTrades(trades);
  }

  /**
   * Непонятные сообщения не пишем каждое — иначе счётчик сам себя забьёт.
   * Пишем один раз на каждый новый вид мусора, дальше только молчим.
   */
  private noteIgnored(reason: string): void {
    this.ignoredReasons.set(reason, (this.ignoredReasons.get(reason) ?? 0) + 1);
    if (this.seenReasons.has(reason)) return;
    this.seenReasons.add(reason);
    this.options.log.debug('ws: пропущено (дальше молчу про это)', { причина: reason });
  }

  /** Сколько всего было пропущено, по видам. Показывается в пульсе. */
  ignoredSummary(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.ignoredReasons);
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      this.socket?.send(JSON.stringify({ op: 'ping' }));
    }, this.pingIntervalMs);
  }

  /** Таймер молчания один на всё соединение: каждое сообщение его сдвигает. */
  private armSilenceWatchdog(): void {
    this.clearSilence();
    this.silenceTimer = setTimeout(() => {
      if (this.stopped) return;
      this.options.log.warn('ws: тишина дольше нормы, переподключаемся', {
        silenceTimeoutMs: this.silenceTimeoutMs,
      });
      const socket = this.socket;
      if (socket !== undefined) {
        socket.close();
      } else {
        this.scheduleReconnect();
      }
    }, this.silenceTimeoutMs);
  }

  private clearSilence(): void {
    if (this.silenceTimer !== undefined) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    this.clearTimers();
    if (this.stopped) return;

    this.attempt += 1;
    const delay = Math.min(
      this.initialBackoffMs * 2 ** (this.attempt - 1),
      this.maxBackoffMs,
    );
    this.options.log.info('ws: переподключение', { attempt: this.attempt, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
    }, delay);
  }

  private clearPing(): void {
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearPing();
    this.clearSilence();
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
