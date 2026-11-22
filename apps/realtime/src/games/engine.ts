import type { CategoryId, EngineId, PublicQuestion } from 'shared';
import type { Content } from 'shared/content';

export type Random = (max: number) => number;

export interface AnswerInput {
  answer: string | number;
  prediction?: 'a' | 'b';
}

export interface TimedAnswer extends AnswerInput {
  at: number;
}

export interface RoundOutcome {
  points: number;
  isCorrect: boolean | null;
}

export interface ScoreContext {
  players: readonly [string, string];
  /** Insertion order is arrival order, which settles ties. */
  answers: ReadonlyMap<string, TimedAnswer>;
  endsAt: number;
}

export interface GameRound {
  /** The only part of the round sent before round:result. It never holds the answer. */
  question: PublicQuestion;
  durationMs: number;
  correct: number | boolean | null;
  accepts(input: AnswerInput): boolean;
  score(context: ScoreContext): Record<string, RoundOutcome>;
  /** Ayna only: whether both players made the same choice. */
  matched?(context: ScoreContext): boolean;
}

export interface EngineInput {
  category: CategoryId;
  seen: ReadonlySet<string>;
  random: Random;
  data: Content;
}

export interface GameEngine {
  id: EngineId;
  createRounds(input: EngineInput): GameRound[];
  harmony?(matches: readonly boolean[]): number;
}

export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Picks random items, preferring ones neither player has seen recently. */
export function pickContent<T extends { id: string }>(
  items: readonly T[],
  count: number,
  seen: ReadonlySet<string>,
  random: Random,
): T[] {
  const unseen = items.filter((item) => !seen.has(item.id));
  const repeated = items.filter((item) => seen.has(item.id));
  const picked = [...shuffled(unseen, random), ...shuffled(repeated, random)].slice(0, count);
  if (picked.length < count) throw new Error(`Not enough content: ${picked.length}/${count}`);
  return picked;
}

export function quizOfType<T extends Content['quiz'][number]['type']>(
  { data, category }: EngineInput,
  type: T,
) {
  return data.quiz.filter(
    (question): question is Extract<Content['quiz'][number], { type: T }> =>
      question.category === category && question.type === type,
  );
}
