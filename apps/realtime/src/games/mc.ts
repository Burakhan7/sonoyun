import { ENGINES, type PublicQuestion } from 'shared';
import type { EmojiQuestion, McQuestion } from 'shared/content';
import {
  pickContent,
  quizOfType,
  shuffled,
  type GameEngine,
  type GameRound,
  type Random,
  type RoundOutcome,
} from './engine.js';

const BASE_POINTS = 100;
const POINTS_PER_SECOND = 5;

/** Builds a four-option round. The correct option is always index 0 in the source data. */
export function createChoiceRound(
  source: McQuestion | EmojiQuestion,
  seconds: number,
  random: Random,
): GameRound {
  const order = shuffled([0, 1, 2, 3], random);
  const options = order.map((index) => source.options[index]!) as [string, string, string, string];
  const correctIndex = order.indexOf(source.answerIndex);
  const question: PublicQuestion =
    source.type === 'mc'
      ? { type: 'mc', id: source.id, prompt: source.prompt, options }
      : { type: 'emoji', id: source.id, prompt: source.prompt, emoji: source.emoji, options };

  return {
    question,
    durationMs: seconds * 1000,
    correct: correctIndex,
    accepts: ({ answer }) => Number.isInteger(answer) && Number(answer) >= 0 && Number(answer) <= 3,
    score({ players, answers, endsAt }) {
      const outcomes: Record<string, RoundOutcome> = {};
      for (const player of players) {
        const entry = answers.get(player);
        const isCorrect = entry?.answer === correctIndex;
        const remaining = entry ? Math.max(0, Math.floor((endsAt - entry.at) / 1000)) : 0;
        outcomes[player] = {
          points: isCorrect ? BASE_POINTS + remaining * POINTS_PER_SECOND : 0,
          isCorrect,
        };
      }
      return outcomes;
    },
  };
}

export const mcEngine: GameEngine = {
  id: 'mc',
  createRounds(input) {
    const { rounds, roundSeconds } = ENGINES.mc;
    return pickContent(quizOfType(input, 'mc'), rounds, input.seen, input.random).map((question) =>
      createChoiceRound(question, roundSeconds!, input.random),
    );
  },
};
