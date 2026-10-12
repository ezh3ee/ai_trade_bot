/**
 * Рендер шаблонов промпта вида {{market.price}} (§5).
 *
 * Правила:
 *  - никакого выполнения кода, только подстановка строк;
 *  - НЕИЗВЕСТНАЯ переменная -> ошибка, а не тихо остаться в промпте.
 *    Молчаливый {{market.prcie} — это отправка модели мусора, и ты об этом
 *    узнаёшь через неделю по ответам.
 */

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

export type TemplateScope = Readonly<Record<string, unknown>>;

export class TemplateError extends Error {
  constructor(
    readonly unknownVariables: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

function readPath(scope: TemplateScope, path: string): unknown {
  let current: unknown = scope;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Есть ли переменная в скоупе и значением ли она (undefined -> нет). */
export function isKnownVariable(scope: TemplateScope, path: string): boolean {
  return readPath(scope, path) !== undefined;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(6);
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function listVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(VARIABLE)) {
    const name = match[1];
    if (name !== undefined) found.add(name);
  }
  return [...found];
}

export function renderTemplate(template: string, scope: TemplateScope): string {
  const used = listVariables(template);
  const unknown = used.filter((path) => !isKnownVariable(scope, path));

  if (unknown.length > 0) {
    throw new TemplateError(
      unknown,
      `В шаблоне есть неизвестные переменные: ${unknown.join(', ')}.\n` +
        `Доступны: ${used.filter((p) => isKnownVariable(scope, p)).join(', ') || '(пусто)'}`,
    );
  }

  return template.replace(VARIABLE, (_whole, path: string) => stringify(readPath(scope, path)));
}

/** Единый документированный список полей, доступных шаблонам (§5). */
export const CONTEXT_FIELDS: readonly string[] = [
  'market.symbol',
  'market.category',
  'market.price',
  'market.priceTime',
  'market.markPrice',
  'market.indexPrice',
  'market.changePct24h',
  'market.high24h',
  'market.low24h',
  'market.fundingRate',
  'market.nextFundingTime',
  'market.openInterest',
  'market.volume24h',
  'market.capturedAt',
  'trigger.kind',
  'trigger.reason',
  'trigger.level',
  'trigger.levelSide',
  'trigger.changePct1m',
  'trigger.volumeRatio',
  'position.direction',
  'position.entryPrice',
  'position.leverage',
  'position.size',
  'position.liquidationPrice',
];