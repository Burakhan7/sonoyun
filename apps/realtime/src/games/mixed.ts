import { ENGINES } from 'shared';
import type { QuizQuestion } from 'shared/content';
import {
  pickContent,
  shuffled,
  type EngineInput,
  type GameEngine,
  type GameRound,
} from './engine.js';
import { createEstimateRound } from './estimate.js';
import { createChoiceRound } from './mc.js';
import { createTfRound } from './tf.js';

const QUIZ_TYPES = ['mc', 'emoji', 'estimate', 'tf'] as const;

/** Question types award very different points, so a mixed round is worth 1 point to its winner. */
export function withRoundWinnerScoring(round: GameRound): GameRound {
  return {
    ...round,
    score(context) {
      const outcomes = round.score(context);
      const points = (player: string) => outcomes[player]?.points ?? 0;
      const arrival = [...context.answers.keys()];
      const [winner] = [...context.players]
        .filter((player) => points(player) > 0)
        .sort((a, b) => points(b) - points(a) || arrival.indexOf(a) - arrival.indexOf(b));

      return Object.fromEntries(
        context.players.map((player) => [
          player,
          {
            points: player === winner ? 1 : 0,
            isCorrect: outcomes[player]?.isCorrect ?? false,
          },
        ]),
      );
    },
  };
}

function createRound(question: QuizQuestion, random: EngineInput['random']): GameRound {
  switch (question.type) {
    case 'mc':
      return createChoiceRound(question, ENGINES.mc.roundSeconds!, random);
    case 'emoji':
      return createChoiceRound(question, ENGINES.emoji.roundSeconds!, random);
    case 'estimate':
      return createEstimateRound(question, ENGINES.estimate.roundSeconds!);
    case 'tf':
      return createTfRound(question, ENGINES.tf.roundSeconds!);
  }
}

export const mixedEngine: GameEngine = {
  id: 'mixed',
  createRounds(input) {
    const pool = input.data.quiz.filter((question) => question.category === input.category);

    // One question of each type first, so a mixed game is always actually mixed.
    const oneOfEach = QUIZ_TYPES.map(
      (type) =>
        pickContent(
          pool.filter((question) => question.type === type),
          1,
          input.seen,
          input.random,
        )[0]!,
    );
    const used = new Set(oneOfEach.map((question) => question.id));
    const extra = pickContent(
      pool.filter((question) => !used.has(question.id)),
      ENGINES.mixed.rounds - oneOfEach.length,
      input.seen,
      input.random,
    );

    return shuffled([...oneOfEach, ...extra], input.random).map((question) =>
      withRoundWinnerScoring(createRound(question, input.random)),
    );
  },
};
