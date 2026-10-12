/**
 * Локальная заглушка OpenAI-совместимого API для проверки цепочки
 * без реального ключа и без трат денег.
 */
Bun.serve({
  port: 11435,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/chat/completions')) {
      const body = (await request.json()) as { messages?: { role: string; content: string }[] };
      const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
      const system = body.messages?.find((m) => m.role === 'system')?.content ?? '';
      console.error('MOCK: системный промпт символов =', system.length);
      console.error('MOCK: пользовательский промпт символов =', user.length);

      const answer = JSON.stringify({
        direction: 'LONG',
        confidence: 62,
        summary: 'Цена пробила уровень сопротивления, объём подтверждает движение.',
        plainExplanation: 'Цена долго не могла пройти вверх, теперь пробила. Это значит, что покупателей стало достаточно.',
        entryPrice: 83800,
        stopLoss: 83400,
        takeProfit: 84600,
        risks: ['откат обратно за уровень', 'всплеск объёма может быть ложным'],
        unknowns: ['нет свечной истории, только сделки'],
        invalidation: 'возврат ниже пробитого уровня',
      });

      return Response.json({
        id: 'mock-1',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
      });
    }

    return new Response('not found', { status: 404 });
  },
});

console.error('MOCK LLM слушает http://localhost:11435/v1');