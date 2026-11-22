import { CATEGORY_IDS } from 'shared';
import { describe, expect, it } from 'vitest';
import { engineInput, expectNoAnswerLeak } from '../test/game-helpers.js';
import { mixedEngine } from './mixed.js';

describe('mixed engine', () => {
  it('never exposes the answer before round:result', () => {
    expectNoAnswerLeak(
      mixedEngine,
      CATEGORY_IDS.filter((id) => id !== 'yasaydi'),
    );
  });

  it('creates 5 unique rounds covering all four types', () => {
    for (let i = 0; i < 50; i += 1) {
      const rounds = mixedEngine.createRounds(engineInput());
      expect(rounds).toHaveLength(5);
      expect(new Set(rounds.map((round) => round.question.id)).size).toBe(5);
      expect(new Set(rounds.map((round) => round.question.type))).toEqual(
        new Set(['mc', 'emoji', 'estimate', 'tf']),
      );
    }
  });

  it('uses the time limit of each question type', () => {
    const limits = { mc: 12_000, emoji: 15_000, estimate: 15_000, tf: 6_000, ayna: 0 };
    for (const round of mixedEngine.createRounds(engineInput())) {
      expect(round.durationMs).toBe(limits[round.question.type]);
    }
  });
});
