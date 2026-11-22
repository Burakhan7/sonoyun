import { CATEGORY_IDS } from 'shared';
import type { EstimateQuestion } from 'shared/content';
import { describe, expect, it } from 'vitest';
import { PLAYERS, engineInput, expectNoAnswerLeak, scoreContext } from '../test/game-helpers.js';
import { createEstimateRound, estimateEngine } from './estimate.js';

const [p1, p2] = PLAYERS;
const source: EstimateQuestion = {
  id: 'q',
  category: 'mutfak',
  type: 'estimate',
  prompt: 'Kaç?',
  answer: 100,
  tolerance: 5,
  unit: 'adet',
};
const round = createEstimateRound(source, 15);
const points = (entries: Parameters<typeof scoreContext>[0]) => {
  const outcomes = round.score(scoreContext(entries));
  return [outcomes[p1]!.points, outcomes[p2]!.points];
};

describe('estimate engine', () => {
  it('never exposes the answer before round:result', () => {
    expectNoAnswerLeak(
      estimateEngine,
      CATEGORY_IDS.filter((id) => id !== 'yasaydi'),
    );
  });

  it('creates 3 15-second rounds', () => {
    const rounds = estimateEngine.createRounds(engineInput());
    expect(rounds).toHaveLength(3);
    expect(rounds[0]!.durationMs).toBe(15_000);
  });

  it('gives the round to the closer guess', () => {
    expect(
      points([
        [p1, { answer: 90 }],
        [p2, { answer: 105 }],
      ]),
    ).toEqual([0, 1]);
  });

  it('adds a bonus for an exact hit', () => {
    expect(
      points([
        [p1, { answer: 100 }],
        [p2, { answer: 105 }],
      ]),
    ).toEqual([2, 0]);
  });

  it('settles equal distance in favor of the first answer', () => {
    expect(
      points([
        [p2, { answer: 110 }],
        [p1, { answer: 90 }],
      ]),
    ).toEqual([0, 1]);
  });

  it('gives both exact bonuses but the round to the first', () => {
    expect(
      points([
        [p2, { answer: 100 }],
        [p1, { answer: 100 }],
      ]),
    ).toEqual([1, 2]);
  });

  it('gives the round to the only player who answered', () => {
    expect(points([[p2, { answer: 1 }]])).toEqual([0, 1]);
    expect(points([])).toEqual([0, 0]);
  });

  it('rejects non-numeric and extreme guesses', () => {
    for (const answer of ['100', Number.NaN, Number.POSITIVE_INFINITY, 1e13]) {
      expect(round.accepts({ answer })).toBe(false);
    }
    expect(round.accepts({ answer: -12.5 })).toBe(true);
  });
});
