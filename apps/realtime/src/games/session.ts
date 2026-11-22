import type { RoundAnswer, ServerEventPayload } from 'shared';
import type { AnswerInput, GameEngine, GameRound, TimedAnswer } from './engine.js';

export interface GameResult {
  winnerId: string | null;
  scores: Record<string, number>;
  harmony?: number;
  forfeit?: boolean;
}

export interface OpenRound {
  roundNo: number;
  total: number;
  question: GameRound['question'];
  endsAt: number;
  durationMs: number;
}

/** Holds one game's authoritative state. Timers live in RoomService. */
export class GameSession {
  readonly scores: Record<string, number>;
  private readonly matches: boolean[] = [];
  private answers = new Map<string, TimedAnswer>();
  private index = -1;
  private endsAt = 0;
  private open = false;

  constructor(
    private readonly engine: GameEngine,
    private readonly rounds: GameRound[],
    private readonly players: readonly [string, string],
    private readonly roundMsOverride?: number,
  ) {
    this.scores = { [players[0]]: 0, [players[1]]: 0 };
  }

  get hasNextRound() {
    return this.index + 1 < this.rounds.length;
  }

  get allAnswered() {
    return this.players.every((player) => this.answers.has(player));
  }

  get isOpen() {
    return this.open;
  }

  private get round() {
    const round = this.rounds[this.index];
    if (!round) throw new Error('No active round');
    return round;
  }

  startRound(now: number): OpenRound {
    if (this.open || !this.hasNextRound) throw new Error('Cannot start a round');
    this.index += 1;
    this.answers = new Map();
    this.open = true;
    const durationMs = this.roundMsOverride ?? this.round.durationMs;
    this.endsAt = now + durationMs;
    return this.currentRound(durationMs);
  }

  currentRound(durationMs = Math.max(0, this.endsAt - Date.now())): OpenRound {
    return {
      roundNo: this.index + 1,
      total: this.rounds.length,
      question: this.round.question,
      endsAt: this.endsAt,
      durationMs,
    };
  }

  hasAnswered(userId: string) {
    return this.answers.has(userId);
  }

  /** The first valid answer in time is locked; everything else is rejected. */
  submit(userId: string, roundNo: number, input: AnswerInput, now: number): boolean {
    if (!this.open || roundNo !== this.index + 1 || now > this.endsAt) return false;
    if (!this.players.includes(userId) || this.answers.has(userId)) return false;
    if (!this.round.accepts(input)) return false;
    this.answers.set(userId, { ...input, at: now });
    return true;
  }

  closeRound(): ServerEventPayload<'round:result'> | null {
    if (!this.open) return null;
    this.open = false;

    const context = { players: this.players, answers: this.answers, endsAt: this.endsAt };
    const outcomes = this.round.score(context);
    if (this.round.matched) this.matches.push(this.round.matched(context));

    const answers: Record<string, RoundAnswer> = {};
    for (const player of this.players) {
      const entry = this.answers.get(player);
      const outcome = outcomes[player] ?? { points: 0, isCorrect: false };
      this.scores[player] = (this.scores[player] ?? 0) + outcome.points;
      answers[player] = {
        answer: entry?.answer ?? null,
        prediction: entry?.prediction ?? null,
        points: outcome.points,
        isCorrect: outcome.isCorrect,
      };
    }
    return {
      roundNo: this.index + 1,
      correct: this.round.correct,
      answers,
      scores: { ...this.scores },
    };
  }

  /** `forfeitWinner` is the remaining player, or null when both players are gone. */
  result(forfeitWinner?: string | null): GameResult {
    const scores = { ...this.scores };
    if (forfeitWinner !== undefined) return { winnerId: forfeitWinner, scores, forfeit: true };

    const [a, b] = this.players;
    const scoreA = scores[a] ?? 0;
    const scoreB = scores[b] ?? 0;
    const winnerId = scoreA === scoreB ? null : scoreA > scoreB ? a : b;
    const harmony = this.engine.harmony?.(this.matches);
    return { winnerId, scores, ...(harmony === undefined ? {} : { harmony }) };
  }
}
