import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BybitWsClient } from '../../src/bybit/bybit-ws.ts';
import type { WsHandle } from '../../src/bybit/bybit-ws.ts';
import type { Trade } from '../../src/market/trade.ts';
import type { TickerData } from '../../src/bybit/ticker.ts';
import type { Logger } from '../../src/config/load.ts';

class FakeSocket implements WsHandle {
  readonly sent: string[] = [];
  private openHandlers: (() => void)[] = [];
  private messageHandlers: ((data: string) => void)[] = [];
  private closeHandlers: ((code: number, reason: string) => void)[] = [];
  private errorHandlers: ((err: unknown) => void)[] = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    for (const handler of this.closeHandlers) handler(1006, 'fake');
  }
  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }
  onMessage(handler: (data: string) => void): void {
    this.messageHandlers.push(handler);
  }
  onClose(handler: (code: number, reason: string) => void): void {
    this.closeHandlers.push(handler);
  }
  onError(handler: (err: unknown) => void): void {
    this.errorHandlers.push(handler);
  }

  fireOpen(): void {
    for (const handler of this.openHandlers) handler();
  }
  fireMessage(data: string): void {
    for (const handler of this.messageHandlers) handler(data);
  }
  fireClose(code = 1006, reason = 'gone'): void {
    for (const handler of this.closeHandlers) handler(code, reason);
  }
  fireError(err: unknown): void {
    for (const handler of this.errorHandlers) handler(err);
  }
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function tradeMessage(id: string, timeMs: number, price = 100): string {
  return JSON.stringify({
    topic: 'publicTrade.BTCUSDT',
    data: [{ T: timeMs, s: 'BTCUSDT', S: 'Buy', v: '1', p: String(price), i: id }],
  });
}

interface Harness {
  readonly sockets: FakeSocket[];
  readonly trades: Trade[];
  readonly resets: string[];
  readonly tickers: TickerData[];
  readonly client: BybitWsClient;
}

function makeHarness(
  overrides: Partial<{ maxGapMs: number; pingIntervalMs: number; silenceTimeoutMs: number }> = {},
): Harness {
  const sockets: FakeSocket[] = [];
  const trades: Trade[] = [];
  const resets: string[] = [];
  const tickers: TickerData[] = [];

  const client = new BybitWsClient({
    url: 'wss://example/linear',
    symbol: 'BTCUSDT',
    log: silentLogger,
    connect: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    onTrades: (incoming) => {
      trades.push(...incoming);
    },
    onReset: (reason) => {
      resets.push(reason);
    },
    onTicker: (update) => {
      tickers.push(update);
    },
    pingIntervalMs: overrides.pingIntervalMs ?? 1000,
    silenceTimeoutMs: overrides.silenceTimeoutMs ?? 30_000,
    maxGapMs: overrides.maxGapMs ?? 10_000,
  });

  return { sockets, trades, resets, tickers, client };
}

describe('клиент Bybit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('подписывается на тему из конфигурации', () => {
    const harness = makeHarness();
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    const sent = harness.sockets[0]?.sent[0] ?? '';
    expect(JSON.parse(sent)).toEqual({
      op: 'subscribe',
      args: ['publicTrade.BTCUSDT', 'tickers.BTCUSDT'],
    });
  });

  it('отдаёт сделки вызывающему коду', () => {
    const harness = makeHarness();
    harness.client.start();
    harness.sockets[0]?.fireOpen();
    harness.sockets[0]?.fireMessage(tradeMessage('a', 1000, 101.5));

    expect(harness.trades).toHaveLength(1);
    expect(harness.trades[0]?.price).toBe(101.5);
  });

  it('шлёт ping каждые 20 секунд', () => {
    // тишина отключена, иначе сторож молчания переподключит сокет
    const harness = makeHarness({ pingIntervalMs: 20_000, silenceTimeoutMs: 600_000 });
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    vi.advanceTimersByTime(60_000);
    const pings = (harness.sockets[0]?.sent ?? []).filter((line) => line.includes('"ping"'));
    expect(pings).toHaveLength(3);
  });

  it('отбрасывает сделки чужого символа', () => {
    const harness = makeHarness();
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    harness.sockets[0]?.fireMessage(
      JSON.stringify({
        topic: 'publicTrade.ETHUSDT',
        data: [{ T: 1, s: 'ETHUSDT', S: 'Buy', v: '1', p: '3000', i: 'x' }],
      }),
    );
    expect(harness.trades).toHaveLength(0);

    harness.sockets[0]?.fireMessage(tradeMessage('a', 2000));
    expect(harness.trades).toHaveLength(1);
  });

  it('переподключается с растущей задержкой', () => {
    const harness = makeHarness();
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    harness.sockets[0]?.fireClose();
    expect(harness.sockets).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(harness.sockets).toHaveLength(2);

    harness.sockets[1]?.fireClose();
    vi.advanceTimersByTime(1000);
    expect(harness.sockets).toHaveLength(2); // ещё рано, ждём 2000

    vi.advanceTimersByTime(1000);
    expect(harness.sockets).toHaveLength(3);
  });

  it('после stop() не переподключается', () => {
    const harness = makeHarness();
    harness.client.start();
    harness.client.stop();
    harness.sockets[0]?.fireClose();

    vi.advanceTimersByTime(60_000);
    expect(harness.sockets).toHaveLength(1);
  });

  it('переподключается при долгом молчании', () => {
    const harness = makeHarness({ silenceTimeoutMs: 30_000 });
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    // 30 секунд тишины -> сторож рвёт сокет
    vi.advanceTimersByTime(30_001);
    // закрытие запускает переподключение с задержкой 1000мс
    vi.advanceTimersByTime(1_000);
    expect(harness.sockets).toHaveLength(2);
  });

  it('сообщение сдвигает сторож молчания', () => {
    const harness = makeHarness({ silenceTimeoutMs: 30_000 });
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    vi.advanceTimersByTime(20_000);
    harness.sockets[0]?.fireMessage(tradeMessage('a', 1000));
    vi.advanceTimersByTime(20_000);

    // если бы сторож не сдвинулся, сокет закрылся бы на 30 секунде
    expect(harness.sockets).toHaveLength(1);
  });

  it('сигналит о разрыве в данных и просит перезапустить окно', () => {
    const harness = makeHarness({ maxGapMs: 10_000 });
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    harness.sockets[0]?.fireMessage(tradeMessage('a', 1_000_000));
    expect(harness.resets).toHaveLength(0);

    // пауза 60 секунд
    harness.sockets[0]?.fireMessage(tradeMessage('b', 1_060_000));
    expect(harness.resets).toHaveLength(1);
    expect(harness.resets[0]).toContain('60000');
  });

  it('не сигналит о разрыве на первых сделках', () => {
    const harness = makeHarness({ maxGapMs: 10_000 });
    harness.client.start();
    harness.sockets[0]?.fireOpen();
    harness.sockets[0]?.fireMessage(tradeMessage('a', 5_000_000));
    harness.sockets[0]?.fireMessage(tradeMessage('b', 5_001_000));
    expect(harness.resets).toHaveLength(0);
  });

  it('переживает мусор в сокете', () => {
    const harness = makeHarness();
    harness.client.start();
    harness.sockets[0]?.fireOpen();

    harness.sockets[0]?.fireMessage('{{{');
    harness.sockets[0]?.fireError(new Error('boom'));
    harness.sockets[0]?.fireMessage(tradeMessage('a', 1000));

    expect(harness.trades).toHaveLength(1);
  });

  it('start() дважды не создаёт второе соединение', () => {
    const harness = makeHarness();
    harness.client.start();
    harness.client.start();
    expect(harness.sockets).toHaveLength(1);
  });
});
