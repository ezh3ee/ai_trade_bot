import type { SpikeEvent } from '../trade.ts';
import type { TradeWindow } from '../trade-window.ts';

/**
 * §9A — всплеск цены.
 *
 * changePct = (currentPrice - referencePrice) / referencePrice
 *
 * referencePrice — последняя сделка, ушедшая за границу зрелости
 * (то есть не новее чем примерно maturityMs назад).
 *
 * Стоимость evaluate: O(1). Никакого поиска по окну.
 */
export class SpikeTrigger {
  constructor(private readonly threshold: number) {}

  evaluate(window: TradeWindow, staleAfterMs: number, nowMs: number): SpikeEvent | undefined {
    const current = window.currentTrade();
    const reference = window.referenceTrade();
    if (current === undefined || reference === undefined) return undefined;
    if (current.id === reference.id) return undefined;
    if (reference.price <= 0) return undefined;

    // §9A: «данные слишком старые/неполные -> триггер не срабатывает»
    if (nowMs - current.timeMs > staleAfterMs) return undefined;

    const changePct = (current.price - reference.price) / reference.price;
    if (Math.abs(changePct) <= this.threshold) return undefined;

    return {
      kind: 'SPIKE',
      direction: changePct > 0 ? 'UP' : 'DOWN',
      changePct,
      referencePrice: reference.price,
      referenceTimeMs: reference.timeMs,
      currentPrice: current.price,
      currentTimeMs: current.timeMs,
    };
  }
}
