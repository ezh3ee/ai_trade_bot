import { describe, expect, it } from 'vitest';
import { parseWsMessage, tradeTopic } from '../../src/bybit/schema.ts';

const REAL = JSON.stringify({
  topic: 'publicTrade.BTCUSDT',
  type: 'snapshot',
  ts: 1672304486868,
  data: [
    {
      T: 1672304486865,
      s: 'BTCUSDT',
      S: 'Buy',
      v: '0.001',
      p: '16578.50',
      L: 'PlusTick',
      i: '20f43950-d8dd-5b31-9112-a178eb6023af',
      BT: false,
      seq: 1783284617,
    },
  ],
});

describe('разбор сообщений Bybit', () => {
  it('разбирает реальное сообщение publicTrade', () => {
    const message = parseWsMessage(REAL);
    expect(message.kind).toBe('trades');
    if (message.kind !== 'trades') return;

    expect(message.trades).toHaveLength(1);
    const trade = message.trades[0];
    expect(trade?.id).toBe('20f43950-d8dd-5b31-9112-a178eb6023af');
    expect(trade?.timeMs).toBe(1672304486865);
    // цена и объём приходят строками
    expect(trade?.price).toBe(16578.5);
    expect(trade?.volume).toBe(0.001);
  });

  it('держит пачку до 1024 сделок', () => {
    const data = Array.from({ length: 1024 }, (_, index) => ({
      T: 1672304486865 + index,
      s: 'BTCUSDT',
      S: index % 2 === 0 ? 'Buy' : 'Sell',
      v: '0.5',
      p: '100.25',
      i: `id-${index}`,
    }));
    const message = parseWsMessage(JSON.stringify({ topic: 'publicTrade.BTCUSDT', data }));
    expect(message.kind).toBe('trades');
    if (message.kind !== 'trades') return;
    expect(message.trades).toHaveLength(1024);
    expect(message.trades[1023]?.id).toBe('id-1023');
  });

  it('узнаёт ответ на ping', () => {
    const message = parseWsMessage(
      JSON.stringify({ success: true, ret_msg: 'pong', conn_id: 'abc', op: 'ping' }),
    );
    expect(message.kind).toBe('pong');
  });

  it('узнаёт подтверждение подписки', () => {
    const message = parseWsMessage(
      JSON.stringify({ success: true, ret_msg: 'subscribe', conn_id: 'xyz', op: 'subscribe' }),
    );
    expect(message.kind).toBe('subscribed');
    if (message.kind !== 'subscribed') return;
    expect(message.connId).toBe('xyz');
  });

  it('сообщает об отклонённой подписке', () => {
    const message = parseWsMessage(
      JSON.stringify({ success: false, ret_msg: 'topic not exist', op: 'subscribe' }),
    );
    expect(message.kind).toBe('failed');
    if (message.kind !== 'failed') return;
    expect(message.message).toBe('topic not exist');
  });

  it.each([
    ['мусор не JSON', 'не json вовсе'],
    ['пустая строка', ''],
    ['обрезанный JSON', '{"topic":'],
  ])('не падает на мусоре: %s', (_label, raw) => {
    const message = parseWsMessage(raw);
    expect(message.kind).toBe('ignored');
  });

  it('пустой массив сделок — это ноль сделок, а не ошибка', () => {
    const message = parseWsMessage(JSON.stringify({ topic: 'publicTrade.BTCUSDT', data: [] }));
    expect(message.kind).toBe('trades');
    if (message.kind !== 'trades') return;
    expect(message.trades).toHaveLength(0);
  });

  it('не падает на неизвестной теме', () => {
    const message = parseWsMessage(JSON.stringify({ topic: 'orderbook.50.BTCUSDT', data: [] }));
    expect(message.kind).toBe('ignored');
    if (message.kind !== 'ignored') return;
    expect(message.reason).toContain('orderbook');
  });

  it('не падает на сделке без цены', () => {
    const message = parseWsMessage(
      JSON.stringify({
        topic: 'publicTrade.BTCUSDT',
        data: [{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '1', i: 'a' }],
      }),
    );
    expect(message.kind).toBe('ignored');
  });

  it('не падает на нечисловой цене', () => {
    const message = parseWsMessage(
      JSON.stringify({
        topic: 'publicTrade.BTCUSDT',
        data: [{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '1', p: 'дорого', i: 'a' }],
      }),
    );
    expect(message.kind).toBe('ignored');
  });

  it('не падает на строке вместо массива', () => {
    const message = parseWsMessage(JSON.stringify({ topic: 'publicTrade.BTCUSDT', data: 'нет' }));
    expect(message.kind).toBe('ignored');
  });

  it('не падает на массиве вместо объекта', () => {
    const message = parseWsMessage(JSON.stringify([1, 2, 3]));
    expect(message.kind).toBe('ignored');
  });

  it('тема собирается из конфигурации', () => {
    expect(tradeTopic('BTCUSDT')).toBe('publicTrade.BTCUSDT');
    expect(tradeTopic('ETHUSDT')).toBe('publicTrade.ETHUSDT');
  });
});
