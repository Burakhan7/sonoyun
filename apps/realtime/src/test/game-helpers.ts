import { publicQuestionSchema, type CategoryId } from 'shared';
import { content } from 'shared/content';
import { expect } from 'vitest';
import type { EngineInput, GameEngine, ScoreContext, TimedAnswer } from '../games/engine.js';

export const PLAYERS = ['p1', 'p2'] as const;

export const engineInput = (
  category: CategoryId = 'mutfak',
  seen: ReadonlySet<string> = new Set(),
): EngineInput => ({
  category,
  seen,
  data: content,
  random: (max) => Math.floor(Math.random() * max),
});

export function scoreContext(
  entries: [string, Omit<TimedAnswer, 'at'> & { at?: number }][],
  endsAt = 10_000,
): ScoreContext {
  return {
    players: PLAYERS,
    endsAt,
    answers: new Map(entries.map(([id, entry]) => [id, { at: 0, ...entry }])),
  };
}

const ANSWER_FIELDS = ['answer', 'answerIndex', 'correct', 'tolerance'];

/** Asserts that no public question of an engine, in any category, exposes its answer. */
export function expectNoAnswerLeak(engine: GameEngine, categories: readonly CategoryId[]) {
  for (const category of categories) {
    for (const round of engine.createRounds(engineInput(category))) {
      expect(publicQuestionSchema.safeParse(round.question).success).toBe(true);
      for (const field of ANSWER_FIELDS) expect(round.question).not.toHaveProperty(field);
    }
  }
}
