import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module.ts';
import { MarketModule } from '../market/market.module.ts';
import { BybitModule } from '../bybit/bybit.module.ts';
import { AiModule } from '../ai/ai.module.ts';
import { PlannedAnalysisService } from './planned-analysis.service.ts';

@Module({
  imports: [AppConfigModule, MarketModule, AiModule, BybitModule],
  providers: [PlannedAnalysisService],
})
export class AppModule {}