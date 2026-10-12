import { z } from 'zod';

/**
 * Ответ модели валидируется через Zod (§10).
 *
 * Модель — штука ненадёжная: может вернуть markdown, может вернуть мусор,
 * может забыть поле. Всё это должно превращаться в понятный WAIT, а не в
 * Exception посреди ночи.
 */

export const directionSchema = z.enum(['LONG', 'SHORT', 'WAIT']);

/**
 * null разрешён: модель честно говорит «не могу обосновать уровень».
 * Ключ может быть и вовсе отсутствовать — тогда считаем его null.
 */
const optionalLevel = z.number().finite().nullable().default(null);

export const signalSchema = z
  .object({
    direction: directionSchema,
    /** 0-100. Это самооценка модели, а не вероятность прибыли (§10). */
    confidence: z.number().min(0).max(100),
    summary: z.string().min(1, 'summary обязателен'),
    plainExplanation: z.string().optional(),
    entryPrice: optionalLevel,
    stopLoss: optionalLevel,
    takeProfit: optionalLevel,
    risks: z.array(z.string()).default([]),
    unknowns: z.array(z.string()).default([]),
    invalidation: z.string().optional(),
  })
  .superRefine((signal, ctx) => {
    if (signal.direction === 'WAIT') return;
    if (signal.entryPrice === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['entryPrice'],
        message: 'для LONG/SHORT точка входа обязательна, для WAIT — нет',
      });
    }
  });

export type Signal = z.infer<typeof signalSchema>;

export const WAIT_REASON = 'модель ответила неразборчиво, ждём следующего сигнала';

export const WAIT_SIGNAL: Signal = {
  direction: 'WAIT',
  confidence: 0,
  summary: WAIT_REASON,
  plainExplanation: undefined,
  entryPrice: null,
  stopLoss: null,
  takeProfit: null,
  risks: [],
  unknowns: [],
  invalidation: undefined,
};

/** Достаёт JSON из ответа: модель может обернуть его в ``` или добавить текст. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    // последняя попытка: вырезать первый {...} блок
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/** Никогда не бросает: неразобранный ответ -> WAIT с объяснением. */
export function parseSignal(raw: string): { readonly ok: true; readonly signal: Signal } | { readonly ok: false; readonly reason: string } {
  const json = extractJson(raw);
  if (json === undefined) {
    return { ok: false, reason: 'ответ не содержит JSON' };
  }

  const result = signalSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'корень'}: ${issue.message}`)
      .join('; ');
    return { ok: false, reason: `ответ не прошёл валидацию (${issues})` };
  }

  return { ok: true, signal: result.data };
}