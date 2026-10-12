import { z } from 'zod';
import type { Trade } from '../market/trade.ts';

/**
 * Разбор сообщений Bybit V5 public stream.
 *
 * Всё приходит как unknown (§3). Схема описывает только нужные поля,
 * лишние молча пропускаются — Bybit регулярно добавляет новые.
 *
 * Важно: цена и объём приходят СТРОКАМИ ("16578.50"), не числами.
 */

const decimalString = z.string().transform((value, ctx): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: 'custom', message: `ожидалось число, пришло "${value}"` });
    return z.NEVER;
  }
  return parsed;
});

export const rawTradeSchema = z.object({
  T: z.number().int(),
  p: decimalString,
  v: decimalString,
  S: z.enum(['Buy', 'Sell']),
  L: z
    .enum(['PlusTick', 'MinusTick', 'ZeroPlusTick', 'ZeroMinusTick'])
    .optional(),
  i: z.string().min(1),
  BT: z.boolean().optional(),
  RPI: z.boolean().optional(),
  seq: z.number().int().optional(),
});

const publicTradeMessageSchema = z.object({
  topic: z.string().startsWith('publicTrade.'),
  type: z.string().optional(),
  ts: z.number().optional(),
  data: z.array(rawTradeSchema),
});

const pongSchema = z.union([
  z.object({ op: z.literal('ping') }).loose(),
  z.object({ ret_msg: z.literal('pong') }).loose(),
]);

const subscribeResponseSchema = z.object({
  success: z.boolean(),
  op: z.literal('subscribe'),
  conn_id: z.string().optional(),
  ret_msg: z.string().optional(),
});

export type BybitMessage =
  | { readonly kind: 'trades'; readonly topic: string; readonly trades: readonly Trade[] }
  | { readonly kind: 'pong' }
  | { readonly kind: 'subscribed'; readonly connId: string | undefined }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ignored'; readonly reason: string };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Никогда не бросает: непонятное сообщение -> kind:'ignored'. */
export function parseWsMessage(raw: string): BybitMessage {
  const parsed = parseJson(raw);
  if (parsed === undefined) return { kind: 'ignored', reason: 'не JSON' };

  const subscribeResult = subscribeResponseSchema.safeParse(parsed);
  if (subscribeResult.success) {
    return subscribeResult.data.success === true
      ? { kind: 'subscribed', connId: subscribeResult.data.conn_id }
      : {
          kind: 'failed',
          message: subscribeResult.data.ret_msg ?? 'подписка отклонена',
        };
  }

  const pongResult = pongSchema.safeParse(parsed);
  if (pongResult.success) return { kind: 'pong' };

  const tradesResult = publicTradeMessageSchema.safeParse(parsed);
  if (tradesResult.success) {
    const trades: Trade[] = tradesResult.data.data.map((raw) => ({
      id: raw.i,
      timeMs: raw.T,
      price: raw.p,
      volume: raw.v,
    }));
    return { kind: 'trades', topic: tradesResult.data.topic, trades };
  }

  const topic = readTopic(parsed);
  if (topic !== undefined) {
    return { kind: 'ignored', reason: `тема ${topic} пока не поддерживается` };
  }
  return { kind: 'ignored', reason: 'неизвестное сообщение' };
}

function readTopic(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('topic' in value)) return undefined;
  const topic = value.topic;
  return typeof topic === 'string' ? topic : undefined;
}

export function tradeTopic(symbol: string): string {
  return `publicTrade.${symbol}`;
}
