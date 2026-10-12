import { describe, expect, it } from 'vitest';
import { parseSignal, extractJson, signalSchema, WAIT_SIGNAL } from '../../src/ai/signal-schema.ts';

describe('ответ модели', () => {
  it('разбирает нормальный JSON', () => {
    const result = parseSignal(
      '{"direction":"LONG","confidence":65,"summary":"пробой вверх","entryPrice":83000,"stopLoss":82000,"takeProfit":85000,"risks":["откат"],"invalidation":"закрытие ниже 82000"}',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signal.direction).toBe('LONG');
    expect(result.signal.entryPrice).toBe(83000);
    expect(result.signal.risks).toEqual(['откат']);
  });

  it('вытаскивает JSON из markdown-обёртки', () => {
    const raw = 'Вот ответ:\n```json\n{"direction":"WAIT","confidence":10,"summary":"неясно"}\n```';
    const result = parseSignal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signal.direction).toBe('WAIT');
  });

  it('вытаскивает JSON с болтовнёй вокруг', () => {
    const result = parseSignal(
      'Конечно! {"direction":"SHORT","confidence":40,"summary":"да","entryPrice":82000} Готово.',
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['не JSON', 'извините, я не могу ответить'],
    ['пусто', ''],
    ['не тот тип', '"что-то"'],
    ['нет direction', '{"confidence":50,"summary":"x"}'],
    ['кривое направление', '{"direction":"BUY","confidence":50,"summary":"x"}'],
    ['уверенность не число', '{"direction":"WAIT","confidence":"высоко","summary":"x"}'],
    ['уверенность вне 0-100', '{"direction":"WAIT","confidence":150,"summary":"x"}'],
    ['пустой summary', '{"direction":"WAIT","confidence":50,"summary":""}'],
  ])('мусор превращается в понятную ошибку: %s', (_label, raw) => {
    const result = parseSignal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(5);
  });

  it('SHORT без точки входа тоже отклоняется', () => {
    const result = parseSignal('{"direction":"SHORT","confidence":60,"summary":"x","entryPrice":null}');
    expect(result.ok).toBe(false);
  });

  it('WAIT без точки входа допустим', () => {
    const result = parseSignal('{"direction":"WAIT","confidence":5,"summary":"не хватает данных"}');
    expect(result.ok).toBe(true);
  });

  it('risks и unknowns необязательны', () => {
    const result = parseSignal('{"direction":"WAIT","confidence":0,"summary":"x"}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signal.risks).toEqual([]);
  });

  it('extractJson не бросает на мусоре', () => {
    expect(extractJson('{{{')).toBeUndefined();
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('WAIT_SIGNAL проходит свою же схему', () => {
    expect(signalSchema.safeParse(WAIT_SIGNAL).success).toBe(true);
  });
});