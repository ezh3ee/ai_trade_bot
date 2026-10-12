import type { Trade, VolumeEvent } from '../trade.ts';
import { MINUTE_MS, minuteIndexOf } from '../trade.ts';

/**
 * §9C — всплеск объёма.
 *
 * currentMinuteVolume — объём текущей (незавершённой) минуты
 * averageVolume       — среднее по 9 предыдущим ПОЛНЫМ минутам
 *
 * Срабатывание: currentMinuteVolume > multiplier * averageVolume
 *
 * Минуты выровнены по UTC автоматически: Math.floor(t / 60000), потому
 * что эпоха Unix считается в UTC. Локальная таймзона не участвует.
 *
 * Взят незавершённый текущий минуту, а не последний полный: при буквальном
 * прочтении ТЗ («последняя полная минута») всплеск обнаруживался бы с
 * задержкой до 60 секунд, когда он уже закончился.
 *
 * Один проход на сделку: bucket += volume.
 */
export class VolumeTrigger {
  private readonly buckets = new Map<number, number>();

  constructor(
    private readonly multiplier: number,
    private readonly averageMinutes: number = 9,
  ) {
    if (multiplier <= 0) throw new Error('multiplier must be > 0');
    if (averageMinutes <= 0) throw new Error('averageMinutes must be > 0');
  }

  ingest(trade: Trade): void {
    const key = minuteIndexOf(trade.timeMs);
    this.buckets.set(key, (this.buckets.get(key) ?? 0) + trade.volume);
  }

  /** Сброс после разрыва в данных — историю минут больше не с чем сравнивать. */
  clear(): void {
    this.buckets.clear();
  }

  evaluate(nowMs: number): VolumeEvent | undefined {
    const currentMinute = minuteIndexOf(nowMs);

    let sum = 0;
    for (let back = 2; back <= this.averageMinutes + 1; back += 1) {
      const volume = this.buckets.get(currentMinute - back);
      // §9C: неполный интервал или нулевой объём -> триггер невалиден
      if (volume === undefined || volume <= 0) return undefined;
      sum += volume;
    }

    const averageVolume = sum / this.averageMinutes;
    if (averageVolume <= 0) return undefined;

    const currentMinuteVolume = this.buckets.get(currentMinute) ?? 0;
    const ratio = currentMinuteVolume / averageVolume;
    if (ratio <= this.multiplier) return undefined;

    this.evict(currentMinute);

    return {
      kind: 'VOLUME',
      currentMinuteVolume,
      averageVolume,
      ratio,
      minuteIndex: currentMinute,
    };
  }

  private evict(currentMinute: number): void {
    const cutoff = currentMinute - this.averageMinutes - 2;
    for (const key of this.buckets.keys()) {
      if (key < cutoff) this.buckets.delete(key);
    }
  }
}
