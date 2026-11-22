import { CATEGORY_IDS } from 'shared';
import { describe, expect, it } from 'vitest';
import { PLAYERS, engineInput, expectNoAnswerLeak, scoreContext } from '../test/game-helpers.js';
import { emojiEngine } from './emoji.js';

const [p1, p2] = PLAYERS;

describe('emoji engine', () => {
  it('never exposes the answer before round:result', () => {
    expectNoAnswerLeak(
      emojiEngine,
      CATEGORY_IDS.filter((id) => id !== 'yasaydi'),
    );
  });

  it('creates 5 15-second rounds carrying emojis', () => {
    const rounds = emojiEngine.createRounds(engineInput());
    expect(rounds).toHaveLength(5);
    expect(rounds[0]!.durationMs).toBe(15_000);
    expect(rounds[0]!.question).toHaveProperty('emoji');
  });

  it('scores like mc', () => {
    const round = emojiEngine.createRounds(engineInput())[0]!;
    const correct = round.correct as number;
    const outcomes = round.score(
      scoreContext(
        [
          [p1, { answer: correct, at: 5_000 }],
          [p2, { answer: (correct + 1) % 4, at: 1_000 }],
        ],
        15_000,
      ),
    );
    expect(outcomes[p1]!.points).toBe(150);
    expect(outcomes[p2]!.points).toBe(0);
  });
});
