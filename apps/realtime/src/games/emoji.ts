import { ENGINES } from 'shared';
import { pickContent, quizOfType, type GameEngine } from './engine.js';
import { createChoiceRound } from './mc.js';

export const emojiEngine: GameEngine = {
  id: 'emoji',
  createRounds(input) {
    const { rounds, roundSeconds } = ENGINES.emoji;
    return pickContent(quizOfType(input, 'emoji'), rounds, input.seen, input.random).map(
      (question) => createChoiceRound(question, roundSeconds!, input.random),
    );
  },
};
