import { CATEGORY_IDS } from 'shared';
import { describe, expect, it } from 'vitest';
import { PLAYERS, engineInput, expectNoAnswerLeak, scoreContext } from '../test/game-helpers.js';
import { aynaEngine, createAynaRound } from './ayna.js';

const [p1, p2] = PLAYERS;
const round = createAynaRound({ id: 'q', category: 'yasaydi', a: 'Çay', b: 'Kahve' }, 10);

describe('ayna engine', () => {
  it('sends only the two options', () => {
    expectNoAnswerLeak(aynaEngine, CATEGORY_IDS);
    expect(Object.keys(round.question).sort()).toEqual(['a', 'b', 'id', 'type']);
  });

  it('creates 5 10-second rounds', () => {
    const rounds = aynaEngine.createRounds(engineInput('yasaydi'));
    expect(rounds).toHaveLength(5);
    expect(rounds[0]!.durationMs).toBe(10_000);
  });

  it('gives a point for correctly predicting the opponent', () => {
    const outcomes = round.score(
      scoreContext([
        [p1, { answer: 'a', prediction: 'b' }],
        [p2, { answer: 'b', prediction: 'b' }],
      ]),
    );
    expect(outcomes[p1]!.points).toBe(1);
    expect(outcomes[p2]!.points).toBe(0);
  });

  it('gives no point when the opponent did not answer', () => {
    const context = scoreContext([[p1, { answer: 'a', prediction: 'a' }]]);
    expect(round.score(context)[p1]!.points).toBe(0);
    expect(round.matched!(context)).toBe(false);
  });

  it('detects matching choices', () => {
    expect(
      round.matched!(
        scoreContext([
          [p1, { answer: 'a', prediction: 'a' }],
          [p2, { answer: 'a', prediction: 'b' }],
        ]),
      ),
    ).toBe(true);
  });

  it('calculates harmony as the share of matching rounds', () => {
    expect(aynaEngine.harmony!([true, true, false, true, false])).toBe(60);
    expect(aynaEngine.harmony!([])).toBe(0);
  });

  it('requires both a choice and a prediction', () => {
    expect(round.accepts({ answer: 'a' })).toBe(false);
    expect(round.accepts({ answer: 'c', prediction: 'a' })).toBe(false);
    expect(round.accepts({ answer: 'a', prediction: 'b' })).toBe(true);
  });
});
