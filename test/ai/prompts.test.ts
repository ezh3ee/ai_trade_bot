import { describe, expect, it } from 'vitest';
import { loadPrompts, renderPrompt, promptVariables, PromptsError } from '../../src/ai/prompts.ts';

const GOOD = 'expert:\n  system: "sys {{market.price}}"\n  user: "usr {{trigger.reason}}"\nbeginner:\n  system: "b"\n  user: "u"\n';

const scope = {
  market: { symbol: 'BTCUSDT', price: 83000 },
  trigger: { reason: 'пробой' },
};

describe('промпты из YAML', () => {
  it('читает и проверяет prompts.example.yml из репозитория', () => {
    const prompts = loadPrompts('./prompts.example.yml');
    expect(prompts.expert.system.length).toBeGreaterThan(50);
    expect(prompts.beginner.user.length).toBeGreaterThan(50);
  });

  it('в промптах нет тикера руками — он подставляется (§5)', () => {
    const prompts = loadPrompts('./prompts.example.yml');
    const all = `${prompts.expert.system}${prompts.expert.user}${prompts.beginner.system}${prompts.beginner.user}`;
    expect(all).not.toContain('BTCUSDT');
    expect(all).toContain('{{market.symbol}}');
  });

  it('обе директории требуются', () => {
    expect(() => loadPrompts('./нет-такого.yml')).toThrow(PromptsError);
    expect(() => loadPrompts('./нет-такого.yml')).toThrow(/не найден/);
  });

  it('рендерит выбранный режим', () => {
    const prompts = loadPrompts('./prompts.example.yml');
    const set = renderPrompt(prompts, 'expert', {
      market: {
        symbol: 'ETHUSDT',
        category: 'linear',
        price: 3000,
        priceTime: '2026-01-01T00:00:00.000Z',
        markPrice: 3001,
        indexPrice: 2999,
        changePct24h: 0.02,
        high24h: 3100,
        low24h: 2900,
        fundingRate: 0.0001,
        nextFundingTime: '2026-01-01T08:00:00.000Z',
        openInterest: 1000,
        volume24h: 50000,
        capturedAt: '2026-01-01T00:00:00.000Z',
      },
      trigger: { kind: 'BREAKOUT', reason: 'пробой 2950 вверх', level: 2950, levelSide: 'UP', changePct1m: undefined, volumeRatio: undefined },
      position: { direction: null, entryPrice: null, leverage: null, size: null, liquidationPrice: null },
    });

    expect(set.user).toContain('ETHUSDT');
    expect(set.user).toContain('пробой 2950 вверх');
    expect(set.system).toContain('трейдер');
    expect(set.system).not.toContain('{{');
    expect(set.user).not.toContain('{{');
  });

  it('собирает список переменных', () => {
    const prompts = loadPrompts('./prompts.example.yml');
    const vars = promptVariables(prompts);
    expect(vars.expert).toContain('market.price');
    expect(vars.expert).toContain('trigger.reason');
    expect(vars.beginner).toContain('market.fundingRate');
  });

  it('шаблон без данных об инструменте рендерится пустышками, а не падает', () => {
    const prompts = loadPrompts('./prompts.example.yml');
    // renderPrompt требует ВСЕ переменные: отсутствующая -> ошибка
    expect(() => renderPrompt(prompts, 'expert', { market: { symbol: 'X' } })).toThrow();
  });
});