import type { Trade } from './trade.ts';
import { Deque } from './deque.ts';

export type MatureListener = (trade: Trade, nowMs: number) => void;

/**
 * Хранит сделки двумя «полками».
 *
 *   recent  — сделки НОВЕЕ границы зрелости (последние maturityMs)
 *   matured — сделки СТАРШЕ границы зрелости
 *
 * Граница нужна §9A и §9B: оба требуют «цену примерно минутой назад».
 * Поиск такой сделки перебором стоил бы O(n) на каждый тик. Здесь она
 * находится за O(1): это просто последняя сделка в `matured`.
 *
 * Все часы внутри класса идут по времени СДЕЛКИ (trade.timeMs), а не по
 * системным. Это делает поведение детерминированным и не зависит от
 * дрейфа Date.now() относительно времени биржи.
 */
export class TradeWindow {
  private readonly recent = new Deque<Trade>();
  private readonly matured = new Deque<Trade>();
  private readonly seenIds = new Set<string>();
  private readonly matureListeners = new Set<MatureListener>();
  private previousTrade: Trade | undefined;

  constructor(
    private readonly maturityMs: number,
    private readonly retentionMs: number,
    private readonly dedupMs: number,
  ) {
    if (maturityMs <= 0) throw new Error('maturityMs must be > 0');
    if (retentionMs <= maturityMs) throw new Error('retentionMs must be > maturityMs');
    if (dedupMs > retentionMs) throw new Error('dedupMs must be <= retentionMs');
  }

  /** Вызывается один раз, когда сделка перешагнула границу зрелости. */
  onMature(listener: MatureListener): void {
    this.matureListeners.add(listener);
  }

  /**
   * O(1) амортизированно на сделку.
   * Возвращает false, если сделка-дубль.
   */
  ingest(trade: Trade): boolean {
    if (this.seenIds.has(trade.id)) return false;

    const last = this.recent.peekBack();
    if (last !== undefined && trade.timeMs < last.timeMs) {
      throw new Error(`out-of-order trade: ${trade.id} at ${trade.timeMs}`);
    }

    this.seenIds.add(trade.id);
    this.previousTrade = last;
    this.recent.pushBack(trade);

    this.promote(trade.timeMs);
    this.evict(trade.timeMs);
    return true;
  }

  /** Последняя сделка из окна — текущая цена. */
  currentTrade(): Trade | undefined {
    return this.recent.peekBack();
  }  /** Предпоследняя сделка из окна — цена, с которой сравниваем пересечение. */
  previousTradeOf(): Trade | undefined {
    return this.previousTrade;
  }

  /** Самая свежая сделка, ушедшая за границу зрелости. §9A reference. */
  referenceTrade(): Trade | undefined {
    return this.matured.peekBack();
  }

  /**
   * Полная очистка после разрыва в данных. Подписки на зрелость
   * сохраняются — пересоздавать окно нельзя, иначе потеряются слушатели.
   */
  clear(): void {
    this.recent.clear();
    this.matured.clear();
    this.seenIds.clear();
    this.previousTrade = undefined;
  }

  private promote(nowMs: number): void {
    const boundary = nowMs - this.maturityMs;
    for (;;) {
      const front = this.recent.peekFront();
      if (front === undefined || front.timeMs > boundary) break;
      this.recent.shiftFront();
      this.matured.pushBack(front);
      for (const listener of this.matureListeners) listener(front, nowMs);
    }
  }

  private evict(nowMs: number): void {
    // Сделка выходит из окна -> её id больше не нужен для дедупа.
    // dedupMs <= retentionMs гарантирует, что этот же проход убирает
    // и id, и саму сделку, поэтому второй отдельный проход не нужен.
    const cutoff = nowMs - this.retentionMs;
    for (;;) {
      const front = this.matured.peekFront();
      if (front === undefined || front.timeMs >= cutoff) break;
      this.seenIds.delete(front.id);
      this.matured.shiftFront();
    }
  }
}
