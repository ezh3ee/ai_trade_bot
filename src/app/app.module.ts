import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module.ts';
import { MarketModule } from '../market/market.module.ts';
import { AiModule } from '../ai/ai.module.ts';
import { TelegramModule } from '../telegram/telegram.module.ts';
import { BybitModule } from '../bybit/market-stream.service.ts';
import { PlannedAnalysisService } from './planned-analysis.service.ts';

@Module({
  imports: [AppConfigModule, MarketModule, TelegramModule, AiModule, BybitModule],
  providers: [PlannedAnalysisService],
})
export class AppModule {}