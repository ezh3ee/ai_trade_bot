import type { Trade, TriggerEvent } from './trade.ts';
import { TradeWindow } from './trade-window.ts';
import { SpikeTrigger } from './triggers/spike.ts';
import { BreakoutTrigger } from './triggers/breakout.ts';
import { VolumeTrigger } from './triggers/volume.ts';

export interface TriggerEngineConfig {
  /** §9 SPIKE_PCT */
  readonly spikeThreshold: number;
  /** §9 VOL_MULT */
  readonly volumeMultiplier: number;
  /** §9 WINDOW_MINUTES -> окно уровней для пробоя */
  readonly breakoutWindowMs: number;
  /** §9 SPIKE_WINDOW_SECONDS -> граница «минута назад» */
  readonly maturityMs: number;
  /** сколько сделок держим в памяти */
  readonly retentionMs: number;
  /** окно дедупликации по id */
  readonly dedupMs: number;
  /** старше этого — данные считаются протухшими, триггер молчит */
  readonly staleAfterMs: number;
  /** §9 COOLDOWN_MS */
  readonly cooldownMs: number;
}

/**
 * Точка сборки всех триггеров.
 *
 * Ключевое: evaluate() дергается на КАЖДОМ тике, а не по таймеру.
 * §9B ищет пересечение уровня — это событие, а не состояние. Проверка
 * раз в секунду потеряла бы пробой, случившийся и откатившийся внутри
 * одной секунды.
 *
 * Что реально ограничивается — события (вызов LLM, запись в БД), а не
 * проверки. Здесь ограничение только кулдауном на повтор одного и того же
 * типа события.
 */
export class TriggerEngine {
  private readonly window: TradeWindow;
  private readonly spike: SpikeTrigger;
  private readonly breakout: BreakoutTrigger;
  private readonly volume: VolumeTrigger;
  private readonly lastFiredAt = new Map<TriggerEvent['kind'], number>();

  constructor(private readonly config: TriggerEngineConfig) {
    this.window = new TradeWindow(
      config.maturityMs,
      config.retentionMs,
      config.dedupMs,
    );
    this.spike = new SpikeTrigger(config.spikeThreshold);
    this.breakout = new BreakoutTrigger(config.breakoutWindowMs);
    this.volume = new VolumeTrigger(config.volumeMultiplier);
    this.window.onMature((trade, nowMs) => {
      this.breakout.onMature(trade, nowMs);
    });
  }

  /**
   * Одна сделка на вход. O(1) амортизированно.
   * nowMs — системное время, для проверки протухания.
   */
  ingest(trade: Trade, nowMs: number): TriggerEvent[] {
    if (!this.window.ingest(trade)) return [];
    this.volume.ingest(trade);

    const events: TriggerEvent[] = [];
    const spike = this.spike.evaluate(this.window, this.config.staleAfterMs, nowMs);
    if (spike !== undefined) this.push(events, spike, nowMs);

    const breakout = this.breakout.evaluate(this.window, this.config.staleAfterMs, nowMs);
    if (breakout !== undefined) this.push(events, breakout, nowMs);

    const volume = this.volume.evaluate(nowMs);
    if (volume !== undefined) this.push(events, volume, nowMs);

    return events;
  }

  /** Текущее состояние рынка для снимка контекста (§10). */
  view(): { readonly price: number | undefined; readonly timeMs: number | undefined } {
    const current = this.window.currentTrade();
    return { price: current?.price, timeMs: current?.timeMs };
  }

  /**
   * Полный сброс состояния. Вызывается после разрыва в данных: окно
   * и уровни держат дыры, и триггеры начнут считать по неполной картине.
   */
  reset(): void {
    this.window.clear();
    this.breakout.clear();
    this.volume.clear();
    this.lastFiredAt.clear();
  }

  private push(events: TriggerEvent[], event: TriggerEvent, nowMs: number): void {
    const last = this.lastFiredAt.get(event.kind);
    if (last !== undefined && nowMs - last < this.config.cooldownMs) return;
    this.lastFiredAt.set(event.kind, nowMs);
    events.push(event);
  }
}

export type { Trade, TriggerEvent };
