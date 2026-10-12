import type { ResponseMode } from '../ai/prompts.ts';

/**
 * Состояние приложения, общее для оркестратора и Telegram-бота.
 *
 * Существует, чтобы разорвать цикл: боту нужно знать режим и паузу,
 * но оркестратор создаётся через Telegram-бота. Если бот зависел бы от
 * оркестратора напрямую, Nest увидел бы цикл и не поднялся.
 *
 * Пишет оркестратор, читает бот. Обычный класс, без Nest.
 */
export class RuntimeState {
  private paused = false;
  private mode: ResponseMode;
  private lastSignal: { readonly direction: string; readonly atMs: number } | undefined;
  private analysesToday = 0;
  private todayKey = '';

  constructor(initialMode: ResponseMode) {
    this.mode = initialMode;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get currentMode(): ResponseMode {
    return this.mode;
  }

  get signal(): { readonly direction: string; readonly atMs: number } | undefined {
    return this.lastSignal;
  }

  get analyses(): number {
    return this.analysesToday;
  }

  setPaused(value: boolean): void {
    this.paused = value;
  }

  setMode(value: ResponseMode): void {
    this.mode = value;
  }

  setSignal(direction: string, atMs: number): void {
    this.lastSignal = { direction, atMs };
  }

  /** Сбрасывает счётчик при смене суток. Возвращает false, если лимит исчерпан. */
  takeDailySlot(nowMs: number, limit: number): boolean {
    const key = new Date(nowMs).toISOString().slice(0, 10);
    if (key !== this.todayKey) {
      this.todayKey = key;
      this.analysesToday = 0;
    }
    if (this.analysesToday >= limit) return false;
    this.analysesToday += 1;
    return true;
  }
}