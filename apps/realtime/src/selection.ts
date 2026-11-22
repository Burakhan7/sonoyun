import { randomInt } from 'node:crypto';
import {
  CATEGORY_IDS,
  ENGINE_IDS,
  MIN_CONTENT_PER_ENGINE,
  type CategoryId,
  type EngineId,
} from 'shared';
import { content, type Content } from 'shared/content';

type Random = (max: number) => number;

const QUIZ_ENGINES = ['mc', 'emoji', 'estimate', 'tf'] as const;

export function pickCategory(excluded: Iterable<string>, random: Random = randomInt): CategoryId {
  const blocked = new Set(excluded);
  const available = CATEGORY_IDS.filter((category) => !blocked.has(category));
  const pool = available.length > 0 ? available : CATEGORY_IDS;
  return pool[random(pool.length)]!;
}

export function eligibleEngines(category: CategoryId, data: Content = content): EngineId[] {
  const hasAyna =
    data.ayna.filter((round) => round.category === category).length >= MIN_CONTENT_PER_ENGINE;
  if (category === 'yasaydi') return hasAyna ? ['ayna'] : [];

  const quiz = data.quiz.filter((question) => question.category === category);
  const hasType = (type: (typeof QUIZ_ENGINES)[number]) =>
    quiz.filter((question) => question.type === type).length >= MIN_CONTENT_PER_ENGINE;

  return ENGINE_IDS.filter((engine) => {
    if (engine === 'ayna') return hasAyna;
    if (engine === 'mixed') return QUIZ_ENGINES.every(hasType);
    return hasType(engine);
  });
}

export function pickEngine(category: CategoryId, random: Random = randomInt): EngineId {
  const engines = eligibleEngines(category);
  if (engines.length === 0) throw new Error(`No playable engine for category: ${category}`);
  return engines[random(engines.length)]!;
}
