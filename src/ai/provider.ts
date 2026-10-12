import type { ToolSet } from 'ai';

export interface GenerationOptions {
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** §6: GenerationOptions должен поддерживать tools из пакета ai. */
  readonly tools?: ToolSet;
}

export const DEFAULT_OPTIONS: GenerationOptions = {
  temperature: 0.4,
  maxOutputTokens: 1200,
};

export interface UsageReport {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly elapsedMs: number;
}

export interface GenerationResult {
  readonly text: string;
  readonly modelId: string;
  readonly usage: UsageReport;
}

export interface LlmProvider {
  readonly modelId: string;
  generate(system: string, message: string, options?: GenerationOptions): Promise<string>;
  generateWithRetry(system: string, message: string, options?: GenerationOptions): Promise<GenerationResult>;
}

/**
 * Базовый провайдер (§6).
 *
 * generate() — одна попытка. generateWithRetry() — повторяет с растущей
 * паузой. После исчерпания попыток ошибка уходит вызывающему коду как есть:
 * прятать её нельзя, иначе поломка провайдера выглядит как «модель молчит».
 */
export abstract class BaseLlmProvider implements LlmProvider {
  protected constructor(
    private readonly maxRetries: number,
    private readonly retryDelayMs: number,
  ) {}

  abstract generate(
    system: string,
    message: string,
    options?: GenerationOptions,
  ): Promise<string>;

  async generateWithRetry(
    system: string,
    message: string,
    options?: GenerationOptions,
  ): Promise<GenerationResult> {
    const started = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const text = await this.generate(system, message, options);
        return {
          text,
          modelId: this.modelId,
          usage: {
            inputTokens: this.lastInputTokens,
            outputTokens: this.lastOutputTokens,
            totalTokens: this.lastInputTokens + this.lastOutputTokens,
            elapsedMs: Date.now() - started,
          },
        };
      } catch (error: unknown) {
        lastError = error;
        if (attempt === this.maxRetries) break;
        await this.delay(this.retryDelayMs * 2 ** attempt);
      }
    }

    throw new LlmError(
      `Запрос к LLM не удался после ${this.maxRetries + 1} попыток: ${describeError(lastError)}`,
    );
  }

  abstract readonly modelId: string;

  protected lastInputTokens = 0;
  protected lastOutputTokens = 0;

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}