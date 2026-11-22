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
      createRound(question, input.random),
    );
  },
};
