import { ENGINES } from 'shared';
import type { TfQuestion } from 'shared/content';
import {
  pickContent,
  quizOfType,
  type GameEngine,
  type GameRound,
  type RoundOutcome,
} from './engine.js';

/** Clients answer 1 for true and 0 for false. */
export function createTfRound(source: TfQuestion, seconds: number): GameRound {
  const correctValue = source.answer ? 1 : 0;

  return {
    question: { type: 'tf', id: source.id, prompt: source.prompt },
    durationMs: seconds * 1000,
    correct: source.answer,
    accepts: ({ answer }) => answer === 0 || answer === 1,
    score({ players, answers }) {
      const firstCorrect = [...answers].find(([, entry]) => entry.answer === correctValue)?.[0];
      const outcomes: Record<string, RoundOutcome> = {};
      for (const player of players) {
        const isCorrect = answers.get(player)?.answer === correctValue;
        outcomes[player] = {
          points: isCorrect ? (player === firstCorrect ? 2 : 1) : 0,
          isCorrect,
        };
      }
      return outcomes;
    },
  };
}

export const tfEngine: GameEngine = {
  id: 'tf',
  createRounds(input) {
    const { rounds, roundSeconds } = ENGINES.tf;
    return pickContent(quizOfType(input, 'tf'), rounds, input.seen, input.random).map((question) =>
      createTfRound(question, roundSeconds!),
    );
  },
};
