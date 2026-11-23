import { describe, expect, it } from 'vitest';
import { clientEventSchemas, publicQuestionSchema, serverEventSchemas } from './events.js';

describe('event contract', () => {
  it('defines every event in SPEC §14', () => {
    expect(Object.keys(clientEventSchemas)).toHaveLength(16);
    expect(Object.keys(serverEventSchemas)).toHaveLength(16);
  });

  it.each([
    { type: 'mc', id: 'q', prompt: 'p', options: ['a', 'b', 'c', 'd'], answerIndex: 0 },
    {
      type: 'emoji',
      id: 'q',
      prompt: 'p',
      emoji: 'e',
      options: ['a', 'b', 'c', 'd'],
      answerIndex: 0,
    },
    { type: 'tf', id: 'q', prompt: 'p', answer: true },
    { type: 'estimate', id: 'q', prompt: 'p', unit: 'yıl', answer: 2000, tolerance: 1 },
  ])('rejects a public $type question that carries its answer', (question) => {
    expect(publicQuestionSchema.safeParse(question).success).toBe(false);
  });

  it('rejects unknown fields and oversized chat messages', () => {
    expect(clientEventSchemas['queue:join'].safeParse({ extra: true }).success).toBe(false);
    expect(clientEventSchemas['chat:send'].safeParse({ body: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });
});
