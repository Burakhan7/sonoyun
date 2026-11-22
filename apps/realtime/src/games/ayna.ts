import { ENGINES } from 'shared';
import type { AynaRound } from 'shared/content';
import { pickContent, type GameEngine, type GameRound, type RoundOutcome } from './engine.js';

export function createAynaRound(source: AynaRound, seconds: number): GameRound {
  return {
    question: { type: 'ayna', id: source.id, a: source.a, b: source.b },
    durationMs: seconds * 1000,
    correct: null,
    accepts: ({ answer, prediction }) =>
      (answer === 'a' || answer === 'b') && (prediction === 'a' || prediction === 'b'),
    score({ players, answers }) {
      const outcomes: Record<string, RoundOutcome> = {};
      for (const [index, player] of players.entries()) {
        const opponent = players[index === 0 ? 1 : 0];
        const prediction = answers.get(player)?.prediction;
        const opponentChoice = answers.get(opponent)?.answer;
        const isCorrect = prediction !== undefined && prediction === opponentChoice;
        outcomes[player] = { points: isCorrect ? 1 : 0, isCorrect };
      }
      return outcomes;
    },
    matched({ players, answers }) {
      const first = answers.get(players[0])?.answer;
      return first !== undefined && first === answers.get(players[1])?.answer;
    },
  };
}

export const aynaEngine: GameEngine = {
  id: 'ayna',
  createRounds(input) {
    const { rounds, roundSeconds } = ENGINES.ayna;
    const pool = input.data.ayna.filter((round) => round.category === input.category);
    return pickContent(pool, rounds, input.seen, input.random).map((round) =>
      createAynaRound(round, roundSeconds!),
    );
  },
  harmony(matches) {
    if (matches.length === 0) return 0;
    return Math.round((matches.filter(Boolean).length / matches.length) * 100);
  },
};
