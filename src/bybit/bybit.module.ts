import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module.ts';
import { AiModule } from '../ai/ai.module.ts';
import { MarketStreamService } from './market-stream.service.ts';

/** Только сборка. Логики здесь нет. */
@Module({
  imports: [MarketModule, AiModule],
  providers: [MarketStreamService],
  exports: [MarketStreamService],
})
export class BybitModule {}