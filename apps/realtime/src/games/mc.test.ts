import { CATEGORY_IDS, ENGINES } from 'shared';
import { content, type McQuestion } from 'shared/content';
import { describe, expect, it } from 'vitest';
import { PLAYERS, engineInput, expectNoAnswerLeak, scoreContext } from '../test/game-helpers.js';
import { createChoiceRound, mcEngine } from './mc.js';

const source = content.quiz.find((question) => question.type === 'mc') as McQuestion;
const [p1, p2] = PLAYERS;
const random = (max: number) => Math.floor(Math.random() * max);

describe('mc engine', () => {
  it('never exposes the answer before round:result', () => {
    expectNoAnswerLeak(
      mcEngine,
      CATEGORY_IDS.filter((id) => id !== 'yasaydi'),
    );
  });

  it('creates 5 unique 12-second rounds', () => {
    const rounds = mcEngine.createRounds(engineInput());
    expect(rounds).toHaveLength(ENGINES.mc.rounds);
    expect(new Set(rounds.map((round) => round.question.id)).size).toBe(5);
    expect(rounds[0]!.durationMs).toBe(12_000);
  });

  it('tracks the correct option through the shuffle', () => {
    for (let i = 0; i < 100; i += 1) {
      const round = createChoiceRound(source, 12, random);
      const { question } = round;
      if (question.type !== 'mc') throw new Error('Expected mc');
      expect(question.options[round.correct as number]).toBe(source.options[0]);
      expect([...question.options].sort()).toEqual([...source.options].sort());
    }
  });

  it('actually moves the correct option', () => {
    const positions = new Set(
      Array.from({ length: 200 }, () => createChoiceRound(source, 12, random).correct),
    );
    expect(positions).toEqual(new Set([0, 1, 2, 3]));
  });

  it('scores 100 + 5 per remaining second, wrong and missing as 0', () => {
    const round = createChoiceRound(source, 12, random);
    const correct = round.correct as number;
    const outcomes = round.score(
      scoreContext(
        [
          [p1, { answer: correct, at: 3_500 }],
          [p2, { answer: (correct + 1) % 4, at: 1_000 }],
        ],
        10_000,
      ),
    );
    expect(outcomes[p1]).toEqual({ points: 130, isCorrect: true });
    expect(outcomes[p2]).toEqual({ points: 0, isCorrect: false });
    expect(round.score(scoreContext([]))[p1]).toEqual({ points: 0, isCorrect: false });
  });

  it('rejects answers outside the four options', () => {
    const round = createChoiceRound(source, 12, random);
    for (const answer of [-1, 4, 1.5, '1']) expect(round.accepts({ answer })).toBe(false);
    expect(round.accepts({ answer: 3 })).toBe(true);
  });
});
