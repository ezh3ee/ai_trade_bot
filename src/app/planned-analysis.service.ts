import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AnalysisOrchestrator } from './orchestrator.ts';
import { ORCHESTRATOR } from '../tokens.ts';

/**
 * Запускает плановый анализ раз в минуту (§9D) и гасит таймер при остановке.
 * Вся работа — внутри оркестратора, здесь только жизненный цикл.
 */
@Injectable()
export class PlannedAnalysisService implements OnModuleInit, OnModuleDestroy {
  private stop: (() => void) | undefined;

  constructor(@Inject(ORCHESTRATOR) private readonly orchestrator: AnalysisOrchestrator) {}

  onModuleInit(): void {
    this.stop = this.orchestrator.startPlanned();
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = undefined;
  }
}