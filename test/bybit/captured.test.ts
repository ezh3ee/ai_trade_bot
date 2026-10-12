import { describe, expect, it } from 'vitest';
import { parseWsMessage } from '../../src/bybit/schema.ts';

/**
 * Сообщения, снятые с реального wss://stream.bybit.com/v5/public/linear.
 * Если Bybit поменяет формат, тесты упадут на реальном трафике, а не
 * через неделю в проде.
 */
const CAPTURED = [
  {
    name: 'пачка продаж по одной цене',
    raw: '{"topic":"publicTrade.BTCUSDT","type":"snapshot","ts":1791734501468,"data":[{"T":1791734501468,"s":"BTCUSDT","S":"Sell","v":"0.469","p":"83718.20","L":"ZeroMinusTick","i":"f64dc266-9379-57a2-8deb-f32cc882082f","BT":false,"RPI":false,"seq":823853336377},{"T":1791734501468,"s":"BTCUSDT","S":"Sell","v":"0.163","p":"83718.20","L":"ZeroMinusTick","i":"93f38315-0d0f-559a-bcbd-5d7d1478326a","BT":false,"RPI":false,"seq":823853336377},{"T":1791734501468,"s":"BTCUSDT","S":"Sell","v":"0.253","p":"83718.20","L":"ZeroMinusTick","i":"71b9258e-c029-510c-8a9a-2c19656f9681","BT":false,"RPI":false,"seq":823853336377}]}',
    expected: 3,
  },
  {
    name: 'смена цены вверх',
    raw: '{"topic":"publicTrade.BTCUSDT","type":"snapshot","ts":1791734501934,"data":[{"T":1791734501933,"s":"BTCUSDT","S":"Buy","v":"0.093","p":"83718.30","L":"PlusTick","i":"f7cdf237-7d07-5f98-aa64-1e4a39c162c0","BT":false,"RPI":false,"seq":823853338159},{"T":1791734501933,"s":"BTCUSDT","S":"Buy","v":"0.001","p":"83718.30","L":"ZeroPlusTick","i":"88493562-dc0a-5d51-9476-de549f3e80ee","BT":false,"RPI":false,"seq":823853338159}]}',
    expected: 2,
  },
  {
    name: 'смена цены вниз',
    raw: '{"topic":"publicTrade.BTCUSDT","type":"snapshot","ts":1791734501936,"data":[{"T":1791734501935,"s":"BTCUSDT","S":"Sell","v":"0.008","p":"83718.20","L":"MinusTick","i":"c86fee9d-361d-5ec5-adde-8ecb945c0be1","BT":false,"RPI":false,"seq":823853338167}]}',
    expected: 1,
  },
];

describe('реальные сообщения с биржи', () => {
  it.each(CAPTURED)('разбирает: $name', ({ raw, expected }) => {
    const message = parseWsMessage(raw);
    expect(message.kind).toBe('trades');
    if (message.kind !== 'trades') return;
    expect(message.trades).toHaveLength(expected);
  });

  it('знает все четыре значения направления цены', () => {
    for (const direction of ['PlusTick', 'MinusTick', 'ZeroPlusTick', 'ZeroMinusTick']) {
      const raw = JSON.stringify({
        topic: 'publicTrade.BTCUSDT',
        data: [{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '1', p: '100', L: direction, i: 'x' }],
      });
      expect(parseWsMessage(raw).kind).toBe('trades');
    }
  });

  it('разбирает объём с дробной точкой и цену с двумя знаками', () => {
    const message = parseWsMessage(CAPTURED[0]?.raw ?? '');
    if (message.kind !== 'trades') throw new Error('ожидались сделки');
    expect(message.trades[0]?.price).toBe(83718.2);
    expect(message.trades[0]?.volume).toBeCloseTo(0.469, 9);
  });
});
