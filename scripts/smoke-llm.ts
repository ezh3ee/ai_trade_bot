/**
 * Разовая проверка: доходит ли запрос до LLM через конфигурацию.
 *
 * Запуск:  bun run smoke
 *
 * Нужен заполненный .env. Ничего не пишет в Telegram и в базу —
 * только делает один запрос и печатает результат.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { loadConfig } from '../src/config/load.ts';

async function main(): Promise<void> {
  const config = loadConfig();

  console.log('--- проверка LLM ---');
  console.log(`baseUrl : ${config.llm.baseUrl}`);
  console.log(`model   : ${config.llm.model}`);
  console.log(`key     : ${config.llm.apiKey.slice(0, 4)}… (${config.llm.apiKey.length} симв.)`);
  console.log('');

  const provider = createOpenAICompatible({
    name: 'configured-provider',
    baseURL: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
  });

  const started = Date.now();
  const result = await generateText({
    model: provider(config.llm.model),
    instructions: 'Ты отвечаешь одним словом.',
    prompt: 'Напиши слово «работает» и ничего больше.',
    maxRetries: 0,
  });
  const elapsed = Date.now() - started;

  console.log(`ответ      : ${result.text.trim()}`);
  console.log(`модель     : ${result.response.modelId}`);
  console.log(`причина    : ${result.finishReason}`);
  console.log(`входных    : ${result.usage.inputTokens ?? 0} токенов`);
  console.log(`выходных   : ${result.usage.outputTokens ?? 0} токенов`);
  console.log(`всего      : ${result.usage.totalTokens ?? 0} токенов`);
  console.log(`время      : ${elapsed} мс`);
  console.log('');
  console.log('--- всё работает ---');
}

function causeOf(error: unknown): unknown {
  if (error instanceof Error && 'cause' in error) return error.cause;
  return undefined;
}

main().catch((error: unknown) => {
  console.error('');
  console.error('--- LLM не отвечает ---');
  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`);
    const cause = causeOf(error);
    if (cause !== undefined) console.error(`причина: ${String(cause)}`);
  } else {
    console.error(String(error));
  }
  console.error('');
  console.error('Что проверить:');
  console.error('  1. LLM_BASE_URL — обычно заканчивается на /v1');
  console.error('  2. LLM_API_KEY  — без пробелов и кавычек');
  console.error('  3. LLM_MODEL    — точное имя модели у провайдера');
  process.exitCode = 1;
});
