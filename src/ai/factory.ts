import type { LlmProvider } from './provider.ts';
import { OpenAiCompatibleProvider } from './openai-provider.ts';
import type { AppConfig } from '../config/schema.ts';

/**
 * Выбор провайдера по конфигурации (§6).
 *
 * Добавление нового провайдера не должно трогать анализ рынка: сюда
 * добавляется ветка, всё остальное остаётся как есть.
 */
export class LlmFactory {
  constructor(private readonly config: AppConfig) {}

  create(): LlmProvider {
    return new OpenAiCompatibleProvider(
      this.config.llm.model,
      this.config.llm.baseUrl,
      this.config.llm.apiKey,
      this.config.llm.maxRetries,
      1_000,
    );
  }
}