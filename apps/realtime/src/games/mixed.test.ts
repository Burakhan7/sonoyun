import { CATEGORY_IDS } from 'shared';
import { describe, expect, it } from 'vitest';
import { PLAYERS, engineInput, expectNoAnswerLeak, scoreContext } from '../test/game-helpers.js';
import type { GameRound } from './engine.js';
import { mixedEngine, withRoundWinnerScoring } from './mixed.js';

const [p1, p2] = PLAYERS;

const fixedRound = (first: number, second: number) =>
  withRoundWinnerScoring({
    question: { type: 'tf', id: 'q', prompt: 'İfade' },
    durationMs: 1000,
    correct: true,
    accepts: () => true,
    score: () => ({
      [p1]: { points: first, isCorrect: first > 0 },
      [p2]: { points: second, isCorrect: second > 0 },
    }),
  } satisfies GameRound);

describe('mixed scoring', () => {
  const answered = scoreContext([
    [p2, { answer: 1 }],
    [p1, { answer: 1 }],
  ]);

  it('gives 1 point to the round winner, whatever the question type awards', () => {
    const outcomes = fixedRound(160, 105).score(answered);
    expect(outcomes[p1]).toEqual({ points: 1, isCorrect: true });
    expect(outcomes[p2]).toEqual({ points: 0, isCorrect: true });
  });

  it('settles equal points in favor of the first answer', () => {
    const outcomes = fixedRound(120, 120).score(answered);
    expect(outcomes[p1]!.points).toBe(0);
    expect(outcomes[p2]!.points).toBe(1);
  });

  it('gives nobody a point when both miss', () => {
    const outcomes = fixedRound(0, 0).score(answered);
    expect(outcomes[p1]!.points).toBe(0);
    expect(outcomes[p2]!.points).toBe(0);
  });
});

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
