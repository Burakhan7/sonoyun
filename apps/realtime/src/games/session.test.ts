import { describe, expect, it } from 'vitest';
import { PLAYERS, engineInput } from '../test/game-helpers.js';
import { aynaEngine } from './ayna.js';
import type { GameEngine, GameRound } from './engine.js';
import { GameSession } from './session.js';
import { tfEngine } from './tf.js';

const [p1, p2] = PLAYERS;

const tfRound = (id: string): GameRound => ({
  question: { type: 'tf', id, prompt: 'İfade' },
  durationMs: 6000,
  correct: true,
  accepts: ({ answer }) => answer === 0 || answer === 1,
  score: ({ players, answers }) =>
    Object.fromEntries(
      players.map((player) => {
        const isCorrect = answers.get(player)?.answer === 1;
        return [player, { points: isCorrect ? 1 : 0, isCorrect }];
      }),
    ),
});
const session = (count = 2, engine: GameEngine = tfEngine) =>
  new GameSession(
    engine,
    Array.from({ length: count }, (_, index) => tfRound(`q${index}`)),
    PLAYERS,
  );

describe('GameSession', () => {
  it('locks the first answer', () => {
    const game = session();
    game.startRound(0);
    expect(game.submit(p1, 1, { answer: 0 }, 100)).toBe(true);
    expect(game.submit(p1, 1, { answer: 1 }, 200)).toBe(false);
    game.submit(p2, 1, { answer: 1 }, 300);
    expect(game.closeRound()!.answers[p1]!.answer).toBe(0);
  });

  it('rejects late, wrong-round, invalid and outside answers', () => {
    const game = session();
    game.startRound(0);
    expect(game.submit(p1, 1, { answer: 1 }, 6001)).toBe(false);
    expect(game.submit(p1, 2, { answer: 1 }, 100)).toBe(false);
    expect(game.submit(p1, 1, { answer: 5 }, 100)).toBe(false);
    expect(game.submit('stranger', 1, { answer: 1 }, 100)).toBe(false);
  });

  it('rejects answers after the round closes and closes only once', () => {
    const game = session();
    game.startRound(0);
    expect(game.closeRound()).not.toBeNull();
    expect(game.closeRound()).toBeNull();
    expect(game.submit(p1, 1, { answer: 1 }, 100)).toBe(false);
  });

  it('accumulates scores and picks the winner', () => {
    const game = session();
    game.startRound(0);
    game.submit(p1, 1, { answer: 1 }, 1);
    game.closeRound();
    game.startRound(10);
    game.submit(p1, 2, { answer: 1 }, 11);
    game.submit(p2, 2, { answer: 1 }, 12);
    game.closeRound();

    expect(game.hasNextRound).toBe(false);
    expect(game.result()).toEqual({ winnerId: p1, scores: { [p1]: 2, [p2]: 1 } });
  });

  it('reports a tie with no winner', () => {
    const game = session(1);
    game.startRound(0);
    game.submit(p1, 1, { answer: 1 }, 1);
    game.submit(p2, 1, { answer: 1 }, 2);
    game.closeRound();
    expect(game.result().winnerId).toBeNull();
  });

  it('lets a forfeit override the score', () => {
    const game = session(1);
    game.startRound(0);
    game.submit(p1, 1, { answer: 1 }, 1);
    game.closeRound();
    expect(game.result(p2)).toMatchObject({ winnerId: p2, forfeit: true });
  });

  it('reports harmony for ayna games', () => {
    const rounds = aynaEngine.createRounds(engineInput('yasaydi')).slice(0, 2);
    const game = new GameSession(aynaEngine, rounds, PLAYERS);
    game.startRound(0);
    game.submit(p1, 1, { answer: 'a', prediction: 'a' }, 1);
    game.submit(p2, 1, { answer: 'a', prediction: 'b' }, 2);
    game.closeRound();
    game.startRound(10);
    game.submit(p1, 2, { answer: 'a', prediction: 'b' }, 11);
    game.submit(p2, 2, { answer: 'b', prediction: 'a' }, 12);
    game.closeRound();

    expect(game.result()).toMatchObject({ harmony: 50, scores: { [p1]: 2, [p2]: 1 } });
  });
});
