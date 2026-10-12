import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/schema.ts';
import { MarketFeed } from './market-feed.ts';
import type { TriggerEngineConfig } from './trigger-engine.ts';
import { TriggerEngine } from './trigger-engine.ts';
import { RuntimeState } from '../app/runtime-state.ts';
import { APP_CONFIG, MARKET_FEED, RUNTIME_STATE, TRIGGER_ENGINE } from '../tokens.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;

/** Перевод §9 из конфигурации в параметры движка. */
export function toTriggerEngineConfig(config: AppConfig): TriggerEngineConfig {
  const breakoutWindowMs = config.triggers.windowMinutes * MINUTE_MS;
  const retentionMs = breakoutWindowMs + MINUTE_MS;

  return {
    spikeThreshold: config.triggers.spikePct,
    volumeMultiplier: config.triggers.volMult,
    breakoutWindowMs,
    maturityMs: config.triggers.spikeWindowSeconds * SECOND_MS,
    retentionMs,
    dedupMs: retentionMs,
    staleAfterMs: config.triggers.staleAfterMs,
    cooldownMs: config.schedule.cooldownMs,
  };
}

/**
 * Движок, наблюдаемое состояние и состояние приложения отдаются через
 * useFactory, поэтому сами классы остаются обычным TypeScript без декораторов.
 */
@Module({
  providers: [
    {
      provide: TRIGGER_ENGINE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TriggerEngine =>
        new TriggerEngine(toTriggerEngineConfig(config)),
    },
    {
      provide: MARKET_FEED,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MarketFeed => new MarketFeed(config.bybit.symbol, Date.now()),
    },
    {
      provide: RUNTIME_STATE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RuntimeState => new RuntimeState(config.responseMode),
    },
  ],
  exports: [TRIGGER_ENGINE, MARKET_FEED, RUNTIME_STATE],
})
export class MarketModule {}