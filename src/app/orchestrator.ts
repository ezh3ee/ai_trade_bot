import type { AppConfig } from '../config/schema.ts';
import type { Logger } from '../config/load.ts';
import type { LlmProvider } from '../ai/provider.ts';
import type { Prompts, ResponseMode } from '../ai/prompts.ts';
import { renderPrompt } from '../ai/prompts.ts';
import type { MarketContext } from '../ai/context.ts';
import { buildMarketContext, EMPTY_POSITION } from '../ai/context.ts';
import type { Signal } from '../ai/signal-schema.ts';
import { parseSignal, WAIT_SIGNAL } from '../ai/signal-schema.ts';
import type { TickerSnapshot } from '../bybit/ticker.ts';
import type { TriggerEvent } from '../market/trade.ts';
import type { Notifier } from '../telegram/telegram-bot.ts';
import { formatSignal } from '../telegram/format.ts';
import type { RuntimeState } from './runtime-state.ts';

/**
 * Связка цепочки: триггер -> снимок -> промпт -> LLM -> проверка -> вывод.
 *
 * Чистая логика, без Nest.
 *
 * Куда уходит результат:
 *   LONG / SHORT -> Telegram (и в консоль)
 *   WAIT         -> только консоль, иначе телефон заспамится
 *   ошибки       -> Telegram с ограничителем, иначе молча сломаемся
 *
 * Ограничения, все три важны:
 *   - не запускать новый анализ, пока предыдущий идёт (§9);
 *   - не чаще раза в cooldownMs;
 *   - не больше лимита в сутки.
 */

export interface OrchestratorDeps {
  readonly config: AppConfig;
  readonly log: Logger;
  readonly llm: LlmProvider;
  readonly prompts: Prompts;
  readonly notifier: Notifier;
  readonly state: RuntimeState;
  readonly ticker: () => TickerSnapshot;
  readonly priceNow: () => number | undefined;
  readonly now: () => number;
}

/** Ответ считается устаревшим, если за время генерации рынок заметно уехал. */
const STALE_MOVE_PCT = 0.0015;
const STALE_AFTER_MS = 90_000;

export class AnalysisOrchestrator {
  private inFlight = false;
  private lastRunAtMs: number | undefined;

  constructor(private readonly deps: OrchestratorDeps) {}

  get isPaused(): boolean {
    return this.deps.state.isPaused;
  }

  get currentMode(): ResponseMode {
    return this.deps.state.currentMode;
  }

  get analysesToday(): number {
    return this.deps.state.analyses;
  }

  get lastSignalInfo(): { readonly direction: string; readonly atMs: number } | undefined {
    return this.deps.state.signal;
  }

  pause(): void {
    this.deps.state.setPaused(true);
  }

  resume(): void {
    this.deps.state.setPaused(false);
    this.lastRunAtMs = undefined;
  }

  setMode(mode: ResponseMode): void {
    this.deps.state.setMode(mode);
  }

  /** Плановый запуск раз в минуту (§9D). */
  startPlanned(): () => void {
    const timer = setInterval(() => {
      void this.runPlanned();
    }, this.deps.config.schedule.plannedIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }

  async onTrigger(event: TriggerEvent): Promise<void> {
    this.deps.log.info('триггер', { вид: event.kind });
    await this.analyse(event, 'триггер');
  }

  private async runPlanned(): Promise<void> {
    const ticker = this.deps.ticker();
    const price = this.deps.priceNow();
    if (price === undefined) return;

    await this.analyse(
      { kind: 'PLANNED', currentPrice: price, currentTimeMs: ticker.updatedAtMs },
      'плановый',
    );
  }

  private async analyse(event: TriggerEvent, reason: string): Promise<void> {
    const nowMs = this.deps.now();

if (this.deps.state.isPaused) {
      this.deps.log.debug('на паузе, пропускаю');
      return;
    }
    if (this.inFlight) {
      this.deps.log.debug('анализ уже идёт, пропускаю', { причина: reason });
      return;
    }

    const last = this.lastRunAtMs;
    if (last !== undefined && nowMs - last < this.deps.config.schedule.cooldownMs) {
      this.deps.log.debug('кулдаун', {
        осталось_мс: this.deps.config.schedule.cooldownMs - (nowMs - last),
      });
      return;
    }

if (!this.deps.state.takeDailySlot(nowMs, this.deps.config.llm.dailyLimit)) {
      await this.deps.notifier.reportError(
        `Дневной лимит анализов исчерпан (${this.deps.config.llm.dailyLimit}). Продолжаю наблюдение.`,
      );
      return;
    }

    this.inFlight = true;
    this.lastRunAtMs = nowMs;
    try {
      await this.run(event, reason, nowMs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.notifier.reportError(`Анализ не удался: ${message}`);
    } finally {
      this.inFlight = false;
    }
  }

private async run(event: TriggerEvent, reason: string, nowMs: number): Promise<void> {
    const mode = this.currentMode;
    const context = this.buildContext(event, nowMs);

    this.deps.log.debug('собираю промпт', { режим: mode, причина: reason });
    const prompt = renderPrompt(this.deps.prompts, mode, this.scopeOf(context));
    this.deps.log.debug('промпт', {
      системный_символов: prompt.system.length,
      пользовательский_символов: prompt.user.length,
    });
    this.deps.log.debug('промпт.system', { текст: prompt.system });
    this.deps.log.debug('промпт.user', { текст: prompt.user });

    const result = await this.deps.llm.generateWithRetry(prompt.system, prompt.user);
    this.deps.log.info('LLM ответил', {
      модель: result.modelId,
      токенов: result.usage.totalTokens,
      мс: result.usage.elapsedMs,
    });

    const parsed = parseSignal(result.text);
    this.deps.log.debug('сырой ответ модели', { текст: result.text.slice(0, 800) });

    let signal: Signal;
    if (parsed.ok) {
      signal = parsed.signal;
    } else {
      this.deps.log.warn('ответ модели не разобран', { причина: parsed.reason });
      signal = { ...WAIT_SIGNAL, summary: `Ответ модели не разобран: ${parsed.reason}` };
    }

    const stale = this.isStale(context, nowMs);
    if (stale) this.deps.log.warn('ответ устарел');

    this.deliver(mode, context, signal, stale);
  }

  /**
   * Разделение каналов. WAIT в Telegram не уходит — иначе бот
   * превратится в спам, который ещё и без звука.
   */
  private deliver(
    mode: ResponseMode,
    context: MarketContext,
    signal: Signal,
    stale: boolean,
  ): void {
    const text = formatSignal(mode, context, signal, stale);

if (signal.direction === 'WAIT') {
      this.deps.state.setSignal('WAIT', this.deps.now());
      this.deps.notifier.logOnly(
        `LLM: WAIT | уверенность ${signal.confidence} | ${signal.summary}`,
      );
      this.deps.log.debug('полный разбор WAIT', { текст: text });
      return;
    }

    this.deps.state.setSignal(signal.direction, this.deps.now());
    void this.deps.notifier.notify(text).catch((error: unknown) => {
      this.deps.log.error('не смог отправить сигнал', { ошибка: String(error) });
    });
  }

  private isStale(context: MarketContext, startedAtMs: number): boolean {
    if (this.deps.now() - startedAtMs > STALE_AFTER_MS) return true;
    const snapshotPrice = context.lastTradePrice;
    const currentPrice = this.deps.priceNow();
    if (snapshotPrice === undefined || currentPrice === undefined) return false;
    if (snapshotPrice === 0) return false;
    return Math.abs((currentPrice - snapshotPrice) / snapshotPrice) > STALE_MOVE_PCT;
  }

  private buildContext(event: TriggerEvent, nowMs: number): MarketContext {
    const price = this.deps.priceNow();
    return buildMarketContext({
      symbol: this.deps.config.bybit.symbol,
      category: this.deps.config.bybit.category,
      nowMs,
      lastTradePrice: price,
      lastTradeAtMs: this.deps.ticker().updatedAtMs,
      ticker: this.deps.ticker(),
      trigger: event,
      position: EMPTY_POSITION,
    });
  }

  private scopeOf(context: MarketContext): Readonly<Record<string, unknown>> {
    // Отсутствие рыночных данных (Bybit их иногда не шлёт) — это НЕ ошибка:
    // подставляем null -> печатается «—». Ошибка — только опечатка в имени.
    const orNull = (value: number | string | undefined): number | string | null =>
      value === undefined ? null : value;

    return {
      market: {
        symbol: context.symbol,
        category: context.category,
        price: orNull(context.lastTradePrice),
        priceTime:
          context.lastTradeAtMs === undefined ? null : new Date(context.lastTradeAtMs).toISOString(),
        markPrice: orNull(context.ticker.markPrice),
        indexPrice: orNull(context.ticker.indexPrice),
        changePct24h: orNull(context.ticker.changePct24h),
        high24h: orNull(context.ticker.high24h),
        low24h: orNull(context.ticker.low24h),
        fundingRate: orNull(context.ticker.fundingRate),
        nextFundingTime:
          context.ticker.nextFundingTimeMs === undefined
            ? null
            : new Date(context.ticker.nextFundingTimeMs).toISOString(),
        openInterest: orNull(context.ticker.openInterest),
        volume24h: orNull(context.ticker.volume24h),
        capturedAt: context.capturedAt,
      },
      trigger: {
        kind: context.trigger.kind,
        reason: context.trigger.reason,
        level: orNull(context.trigger.level),
        levelSide: orNull(context.trigger.levelSide),
        changePct1m: orNull(context.trigger.changePct1m),
        volumeRatio: orNull(context.trigger.volumeRatio),
      },
      position: {
        direction: orNull(context.position.direction),
        entryPrice: orNull(context.position.entryPrice),
        leverage: orNull(context.position.leverage),
        size: orNull(context.position.size),
        liquidationPrice: orNull(context.position.liquidationPrice),
      },
    };
  }
}