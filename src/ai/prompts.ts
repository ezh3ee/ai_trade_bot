import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { TemplateScope } from './template.ts';
import { listVariables, renderTemplate, CONTEXT_FIELDS } from './template.ts';

export type ResponseMode = 'expert' | 'beginner';

const templateSchema = z.object({
  system: z.string().min(1, 'system не может быть пустым'),
  user: z.string().min(1, 'user не может быть пустым'),
});

export const promptsSchema = z.object({
  expert: templateSchema,
  beginner: templateSchema,
});

export type Prompts = z.infer<typeof promptsSchema>;

export interface PromptSet {
  readonly system: string;
  readonly user: string;
}

export class PromptsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptsError';
  }
}

/**
 * Загрузка промптов (§5).
 *
 * Порядок: прочитать -> распарсить YAML -> проверить Zod -> проверить, что
 * все переменные шаблонов существуют. Ошибка здесь означает, что приложение
 * не стартует вовсе — это лучше, чем отправить модели мусор.
 */
export function loadPrompts(path: string): Prompts {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new PromptsError(
      `Файл промптов не найден: ${path}\n` +
        'Скопируй prompts.example.yml в prompts.yml и проверь PROMPTS_PATH в .env',
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw) as unknown;
  } catch (error: unknown) {
    throw new PromptsError(`Не удалось распарсить YAML в ${path}: ${String(error)}`);
  }

  const result = promptsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new PromptsError(`Промпты в ${path} не прошли проверку:\n${issues}`);
  }

  return result.data;
}

/** Все переменные, которые шаблоны используют. */
export function promptVariables(prompts: Prompts): Record<ResponseMode, string[]> {
  return {
    expert: listVariables(`${prompts.expert.system}\n${prompts.expert.user}`),
    beginner: listVariables(`${prompts.beginner.system}\n${prompts.beginner.user}`),
  };
}

/** Превращает промпты в готовые строки под конкретный снимок рынка. */
export function renderPrompt(prompts: Prompts, mode: ResponseMode, scope: TemplateScope): PromptSet {
  const set = prompts[mode];
  return {
    system: renderTemplate(set.system, scope),
    user: renderTemplate(set.user, scope),
  };
}

export { CONTEXT_FIELDS };

/** Человеческий список полей для README и ошибок. */
export function describeFields(): string {
  return CONTEXT_FIELDS.join('\n');
}