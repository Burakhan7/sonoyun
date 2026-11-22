import { ENGINES } from 'shared';
import type { EstimateQuestion } from 'shared/content';
import {
  pickContent,
  quizOfType,
  type GameEngine,
  type GameRound,
  type RoundOutcome,
} from './engine.js';

const MAX_ABSOLUTE_GUESS = 1e12;
const EXACT_EPSILON = 1e-9;

export function createEstimateRound(source: EstimateQuestion, seconds: number): GameRound {
  return {
    question: { type: 'estimate', id: source.id, prompt: source.prompt, unit: source.unit },
    durationMs: seconds * 1000,
    correct: source.answer,
    accepts: ({ answer }) =>
      typeof answer === 'number' &&
      Number.isFinite(answer) &&
      Math.abs(answer) <= MAX_ABSOLUTE_GUESS,
    score({ players, answers }) {
      const distance = (player: string) => {
        const entry = answers.get(player);
        return entry ? Math.abs(Number(entry.answer) - source.answer) : Number.POSITIVE_INFINITY;
      };

      // Array.sort is stable, so on equal distance the first arrival keeps the round.
      const [winner] = [...answers.keys()].sort((a, b) => distance(a) - distance(b));
      const outcomes: Record<string, RoundOutcome> = {};
      for (const player of players) {
        const exact = distance(player) <= EXACT_EPSILON;
        const points = (player === winner ? 1 : 0) + (exact ? 1 : 0);
        outcomes[player] = { points, isCorrect: points > 0 };
      }
      return outcomes;
    },
  };
}

export const estimateEngine: GameEngine = {
  id: 'estimate',
  createRounds(input) {
    const { rounds, roundSeconds } = ENGINES.estimate;
    return pickContent(quizOfType(input, 'estimate'), rounds, input.seen, input.random).map(
      (question) => createEstimateRound(question, roundSeconds!),
    );
  },
};
