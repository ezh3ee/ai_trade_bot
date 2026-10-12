import { describe, expect, it } from 'vitest';
import { TradeStreamProcessor } from '../../src/bybit/trade-stream.ts';
import { TriggerEngine } from '../../src/market/trigger-engine.ts';
import type { Trade } from '../../src/market/trade.ts';
import type { Logger } from '../../src/config/load.ts';
import { DEFAULT_CONFIG } from '../market/fixtures.ts';
import { MarketFeed } from '../../src/market/market-feed.ts';

function feed(): MarketFeed {
  return new MarketFeed('BTCUSDT', BASE);
}

interface Recorded {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly meta: Record<string, unknown> | undefined;
}

function recordingLogger(): { readonly log: Logger; readonly lines: Recorded[] } {
  const lines: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, meta?: Record<string, unknown>) => {
    lines.push({ level, message, meta });
  };
  return {
    lines,
    log: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
  };
}

function engine(): TriggerEngine {
  return new TriggerEngine({ ...DEFAULT_CONFIG, cooldownMs: 0 });
}

let idCounter = 0;
function trade(timeMs: number, price: number, volume = 1): Trade {
  idCounter += 1;
  return { id: `t${idCounter}`, timeMs, price, volume };
}

const BASE = 1_700_000_040_000;
const SECOND = 1000;

describe('обработка потока сделок', () => {
  // Часы процессора должны совпадать со временем сделок, иначе всё
  // отсеется проверкой протухания.
  const clock = (): number => BASE;

  it('считает сделки и не падает', () => {
    const { log, lines } = recordingLogger();
    const processor = new TradeStreamProcessor(engine(), feed(), log, clock);

    for (let i = 0; i < 100; i += 1) processor.process([trade(BASE + i * SECOND, 100)]);

    expect(processor.totalTrades).toBe(100);
    expect(lines.filter((line) => line.level === 'error')).toHaveLength(0);
  });

  it('пустой пакет ничего не делает', () => {
    const { log, lines } = recordingLogger();
    const processor = new TradeStreamProcessor(engine(), feed(), log, clock);

    processor.process([]);

    expect(processor.totalTrades).toBe(0);
    expect(lines).toHaveLength(0);
  });

  it('печатает пробой один раз', () => {
    const { log, lines } = recordingLogger();
    const processor = new TradeStreamProcessor(engine(), feed(), log, clock);

    for (let i = 0; i < 120; i += 1) processor.process([trade(BASE + i * SECOND, 100)]);
    processor.process([trade(BASE + 121 * SECOND, 101)]);
    processor.process([trade(BASE + 122 * SECOND, 102)]);
    processor.process([trade(BASE + 123 * SECOND, 103)]);

    const breakouts = lines.filter((line) => line.message.includes('ПРОБОЙ'));
    expect(breakouts).toHaveLength(1);
  });

  it('переживает битую сделку и продолжает считать', () => {
    const { log, lines } = recordingLogger();
    const processor = new TradeStreamProcessor(engine(), feed(), log, clock);

    processor.process([trade(BASE, 100)]);
    // сделка из прошлого — движок её отбросит, поток не должен упасть
    processor.process([trade(BASE - 10 * 60 * SECOND, 100)]);
    processor.process([trade(BASE + SECOND, 100)]);

    expect(lines.filter((line) => line.level === 'error')).toHaveLength(1);
    expect(processor.totalTrades).toBe(3);
  });

it('пульс раз в минуту, а не строчка в секунду (§14)', () => {
    const { log, lines } = recordingLogger();
    let clock = BASE;
    const processor = new TradeStreamProcessor(engine(), feed(), log, () => clock);

    // 301 секунда = 5 полных минут = 5 пульсов
    for (let i = 0; i < 301; i += 1) {
      clock = BASE + i * SECOND;
      processor.process([trade(clock, 100), trade(clock + 10, 100)]);
    }

    const pulses = lines.filter((line) => line.message.includes('/мин'));
    expect(pulses.length).toBe(5);
    // 600 вызовов process() НЕ должны дать 600 строк
    expect(lines.length).toBeLessThan(10);
  });

  it('в пульсе видно цену и mark price', () => {
    const { log, lines } = recordingLogger();
    let clock = BASE;
    const marketFeed = feed();
    marketFeed.applyTicker({ symbol: 'BTCUSDT', markPrice: 83001 }, clock);
    const processor = new TradeStreamProcessor(engine(), marketFeed, log, () => clock);

    for (let i = 0; i < 130; i += 1) {
      clock = BASE + i * SECOND;
      processor.process([trade(clock, 83000)]);
    }

    const pulse = lines.find((line) => line.message.includes('/мин'));
    expect(pulse?.message).toContain('BTCUSDT');
    expect(pulse?.message).toContain('83000');
    expect(pulse?.message).toContain('83001');
  });

  it('сброс чинит движок и обнуляет счётчик', () => {
    const { log, lines } = recordingLogger();
    const processor = new TradeStreamProcessor(engine(), feed(), log, clock);

    for (let i = 0; i < 100; i += 1) processor.process([trade(BASE + i * SECOND, 100)]);
    expect(processor.totalTrades).toBe(100);

    processor.reset('разрыв 60000 мс');

    expect(processor.totalTrades).toBe(0);
    expect(lines.some((line) => line.message.includes('сброшено'))).toBe(true);

    // после сброса движок считает заново, а не от старой картины
    processor.process([trade(BASE + 200 * SECOND, 100)]);
    expect(processor.totalTrades).toBe(1);
  });

  it('после сброса триггеры не срабатывают на дырявых данных', () => {
    const { log, lines } = recordingLogger();
    const processor = new TradeStreamProcessor(engine(), feed(), log, clock);

    for (let i = 0; i < 120; i += 1) processor.process([trade(BASE + i * SECOND, 100)]);
    processor.reset('разрыв');

    // цена прыгает на 10% — но после сброса уровней нет, пробоя быть не должно
    processor.process([trade(BASE + 121 * SECOND, 110)]);
    processor.process([trade(BASE + 122 * SECOND, 111)]);

    expect(lines.filter((line) => line.message.includes('ПРОБОЙ'))).toHaveLength(0);
  });
});