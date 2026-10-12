import type { Trade } from '../trade.ts';
import type { BreakoutEvent, Direction } from '../trade.ts';
import type { TradeWindow } from '../trade-window.ts';
import { Deque } from '../deque.ts';

/**
 * §9B — пробой уровня.
 *
 * Уровни берутся из сделок старше maturityMs (последняя минута исключена)
 * и не старше windowMs. maxOld / minOld поддерживаются двумя очередями:
 *
 *   maxQueue — цены строго убывают, спереди максимум
 *   minQueue — цены строго возрастают, спереди минимум
 *
 * Новая сделка выше текущего максимума вытесняет сзади всё, что ниже неё,
 * потому что те значения уже никогда не смогут стать максимумом: эта
 * сделка выше и выйдет из окна не раньше.
 *
 * Обе очереди получают сделки только после перехода границы зрелости,
 * поэтому текущая цена никогда не попадает в уровень.
 *
 * Событие — это ПЕРЕСЕЧЕНИЕ, а не положение. Проверяется на каждом тике:
 * previous <= max && current > max. Если ждать до конца секунды,
 * пробой и откат внутри одной секунды будут потеряны.
 */
export class BreakoutTrigger {
  private readonly maxQueue = new Deque<Trade>();
  private readonly minQueue = new Deque<Trade>();
  private levelReady = false;

  constructor(private readonly windowMs: number) {}

  /** Вызывается из TradeWindow, когда сделка стала старше границы зрелости. */
  onMature(trade: Trade, nowMs: number): void {
    while (true) {
      const back = this.maxQueue.peekBack();
      if (back === undefined || back.price > trade.price) break;
      this.maxQueue.popBack();
    }
    this.maxQueue.pushBack(trade);

    while (true) {
      const back = this.minQueue.peekBack();
      if (back === undefined || back.price < trade.price) break;
      this.minQueue.popBack();
    }
    this.minQueue.pushBack(trade);

    this.trim(nowMs);
    this.levelReady = this.maxQueue.size > 0 && this.minQueue.size > 0;
  }

  /** Сброс после разрыва в данных — уровни больше не достоверны. */
  clear(): void {
    this.maxQueue.clear();
    this.minQueue.clear();
    this.levelReady = false;
  }

  evaluate(window: TradeWindow, staleAfterMs: number, nowMs: number): BreakoutEvent | undefined {
    if (!this.levelReady) return undefined;

    const current = window.currentTrade();
    const previous = window.previousTradeOf();
    const maxOld = this.maxQueue.peekFront();
    const minOld = this.minQueue.peekFront();
    if (current === undefined || previous === undefined) return undefined;
    if (maxOld === undefined || minOld === undefined) return undefined;
    if (nowMs - current.timeMs > staleAfterMs) return undefined;

    if (previous.price <= maxOld.price && current.price > maxOld.price) {
      return this.build('UP', maxOld.price, previous, current);
    }
    if (previous.price >= minOld.price && current.price < minOld.price) {
      return this.build('DOWN', minOld.price, previous, current);
    }
    return undefined;
  }

  private build(
    direction: Direction,
    level: number,
    previous: Trade,
    current: Trade,
  ): BreakoutEvent {
    return {
      kind: 'BREAKOUT',
      direction,
      level,
      previousPrice: previous.price,
      currentPrice: current.price,
      currentTimeMs: current.timeMs,
    };
  }

  private trim(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (true) {
      const front = this.maxQueue.peekFront();
      if (front === undefined || front.timeMs >= cutoff) break;
      this.maxQueue.shiftFront();
    }
    while (true) {
      const front = this.minQueue.peekFront();
      if (front === undefined || front.timeMs >= cutoff) break;
      this.minQueue.shiftFront();
    }
  }
}
