import { describe, expect, it } from 'vitest';
import { renderTemplate, listVariables, isKnownVariable, TemplateError, CONTEXT_FIELDS } from '../../src/ai/template.ts';

const scope = {
  market: {
    symbol: 'BTCUSDT',
    price: 83000,
    markPrice: 83001.5,
    changePct24h: -0.0123,
    fundingRate: 0.0001,
    capturedAt: '2026-01-01T00:00:00.000Z',
  },
  trigger: { reason: 'пробой уровня 82000 вверх' },
  position: { direction: undefined },
};

describe('рендер шаблонов промпта', () => {
  it('подставляет значения', () => {
    expect(renderTemplate('Цена: {{market.price}}', scope)).toBe('Цена: 83000');
    expect(renderTemplate('{{ market.symbol }}', scope)).toBe('BTCUSDT');
    expect(renderTemplate('{{market.changePct24h}}', scope)).toBe('-0.012300');
  });

  it('неизвестная переменная -> ошибка, а не мусор в промпте (§5)', () => {
    expect(() => renderTemplate('{{market.prcie}}', scope)).toThrow(TemplateError);
    expect(() => renderTemplate('{{market.prcie}}', scope)).toThrow(/market.prcie/);
  });

  it('в ошибке перечислены все неизвестные переменные сразу', () => {
    try {
      renderTemplate('{{a.b}} {{c.d}} {{market.price}}', scope);
      throw new Error('должен был упасть');
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateError);
      const template = error as TemplateError;
      expect(template.unknownVariables).toEqual(['a.b', 'c.d']);
      expect(template.message).toContain('market.price');
    }
  });

  it('значение undefined считается отсутствующей переменной', () => {
    expect(isKnownVariable(scope, 'position.direction')).toBe(false);
    expect(() => renderTemplate('{{position.direction}}', scope)).toThrow(TemplateError);
  });

  it('терпит пробелы внутри скобок', () => {
    expect(renderTemplate('{{  market.price  }}', scope)).toBe('83000');
  });

  it('пустое значение печатается как прочерк, а не как undefined', () => {
    const withNull = { ...scope, market: { ...scope.market, markPrice: null } };
    expect(renderTemplate('{{market.markPrice}}', withNull)).toBe('—');
  });

  it('находит все переменные в шаблоне', () => {
    expect(listVariables('{{a.b}} {{a.b}} {{c}}')).toEqual(['a.b', 'c']);
    expect(listVariables('ничего тут нет')).toEqual([]);
  });

  it('не выполняет код из шаблона', () => {
    expect(() => renderTemplate('{{constructor}}', {})).toThrow(TemplateError);
    expect(() => renderTemplate('{{__proto__}}', {})).toThrow(TemplateError);
    expect(() => renderTemplate('{{toString}}', {})).toThrow(TemplateError);
  });

  it('длинный текст со многими переменными рендерится целиком', () => {
    const template = Array.from({ length: 50 }, (_, i) => `строка ${i}: {{market.price}}`).join('\n');
    const out = renderTemplate(template, scope);
    expect(out.split('\n')).toHaveLength(50);
    expect(out).toContain('строка 49: 83000');
  });

  it('список полей соответствует тому, что используют промпты', () => {
    for (const field of CONTEXT_FIELDS) {
      expect(field.split('.')[0]).toMatch(/^(market|trigger|position)$/);
    }
  });
});