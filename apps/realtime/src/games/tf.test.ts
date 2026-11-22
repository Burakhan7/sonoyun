import { CATEGORY_IDS } from 'shared';
import type { TfQuestion } from 'shared/content';
import { describe, expect, it } from 'vitest';
import { PLAYERS, engineInput, expectNoAnswerLeak, scoreContext } from '../test/game-helpers.js';
import { createTfRound, tfEngine } from './tf.js';

const [p1, p2] = PLAYERS;
const source: TfQuestion = {
  id: 'q',
  category: 'mutfak',
  type: 'tf',
  prompt: 'İfade',
  answer: true,
};
const round = createTfRound(source, 6);

describe('tf engine', () => {
  it('never exposes the answer before round:result', () => {
    expectNoAnswerLeak(
      tfEngine,
      CATEGORY_IDS.filter((id) => id !== 'yasaydi'),
    );
  });

  it('creates 7 6-second rounds', () => {
    const rounds = tfEngine.createRounds(engineInput());
    expect(rounds).toHaveLength(7);
    expect(rounds[0]!.durationMs).toBe(6_000);
  });

  it('gives 1 point plus a bonus to the first correct answer', () => {
    const outcomes = round.score(
      scoreContext([
        [p2, { answer: 1, at: 100 }],
        [p1, { answer: 1, at: 200 }],
      ]),
    );
    expect(outcomes[p2]!.points).toBe(2);
    expect(outcomes[p1]!.points).toBe(1);
  });

  it('gives the bonus to a later correct answer when the first is wrong', () => {
    const outcomes = round.score(
      scoreContext([
        [p1, { answer: 0, at: 100 }],
        [p2, { answer: 1, at: 200 }],
      ]),
    );
    expect(outcomes[p1]!.points).toBe(0);
    expect(outcomes[p2]!.points).toBe(2);
  });

  it('accepts only 0 and 1', () => {
    for (const answer of [2, -1, 'true']) expect(round.accepts({ answer })).toBe(false);
    expect(round.accepts({ answer: 0 })).toBe(true);
  });
});
