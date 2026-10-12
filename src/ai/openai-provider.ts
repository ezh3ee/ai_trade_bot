import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { BaseLlmProvider, DEFAULT_OPTIONS } from './provider.ts';
import type { GenerationOptions } from './provider.ts';

/**
 * Провайдер для любого OpenAI-совместимого API (§6).
 *
 * Намеренно НЕ привязан к вендору: DeepSeek, Grok, OpenRouter, Together,
 * Ollama — всё работает через baseUrl + model из конфигурации.
 */
export class OpenAiCompatibleProvider extends BaseLlmProvider {
  private readonly call: (model: string) => ReturnType<ReturnType<typeof createOpenAICompatible>>;

  constructor(
    override readonly modelId: string,
    baseUrl: string,
    apiKey: string,
    maxRetries: number,
    retryDelayMs: number,
  ) {
    super(maxRetries, retryDelayMs);

    // Некоторые локальные провайдеры требуют непустой ключ, даже если он не
    // проверяется. Заглушка изолирована здесь и документирована (§6).
    const safeKey = apiKey.length > 0 ? apiKey : 'not-required';

    const provider = createOpenAICompatible({
      name: 'openai-compatible',
      baseURL: baseUrl,
      apiKey: safeKey,
    });
    this.call = (model: string) => provider(model);
  }

  async generate(
    system: string,
    message: string,
    options: GenerationOptions = DEFAULT_OPTIONS,
  ): Promise<string> {
    // exactOptionalPropertyTypes не примет `tools: undefined`,
    // поэтому необязательные поля добавляются по факту наличия.
    const request: Parameters<typeof generateText>[0] = {
      model: this.call(this.modelId),
      instructions: system,
      prompt: message,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      // Повторы делает базовый класс, а не SDK: так счётчик попыток один.
      maxRetries: 0,
    };
    if (options.tools !== undefined) request.tools = options.tools;

    const result = await generateText(request);

    this.lastInputTokens = result.usage.inputTokens ?? 0;
    this.lastOutputTokens = result.usage.outputTokens ?? 0;
    return result.text;
  }
}