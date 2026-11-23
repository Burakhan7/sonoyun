import { randomInt } from 'node:crypto';
import type { CategoryId, PublicCard } from 'shared';
import { content, type Content } from 'shared/content';
import { shuffled, type Random } from './games/engine.js';

const LEVELS = ['light', 'personal', 'bold'] as const;

export interface CardOffer {
  cards: PublicCard[];
  pickCount: number;
}

export interface DrawnCards {
  offers: Map<string, CardOffer>;
  /** The extra card added after a tie (SPEC §5.5). */
  systemCard: PublicCard | null;
}

/** Winner: 2 of each level, picks 2. Loser: 1 of each, picks 1. Tie: both as loser + system card. */
export function drawCards(
  category: CategoryId,
  players: readonly [string, string],
  winnerId: string | null,
  random: Random = randomInt,
  data: Content = content,
): DrawnCards {
  const pools = new Map(
    LEVELS.map((level) => [
      level,
      shuffled(
        data.cards.filter((card) => card.category === category && card.level === level),
        random,
      ),
    ]),
  );
  const take = (perLevel: number) =>
    LEVELS.flatMap((level) => pools.get(level)!.splice(0, perLevel));

  const offers = new Map<string, CardOffer>();
  for (const player of players) {
    const isWinner = player === winnerId;
    offers.set(player, { cards: take(isWinner ? 2 : 1), pickCount: isWinner ? 2 : 1 });
  }

  const remaining = LEVELS.flatMap((level) => pools.get(level)!);
  const systemCard = winnerId === null ? (remaining[random(remaining.length)] ?? null) : null;
  return { offers, systemCard };
}

export function randomPicks({ cards, pickCount }: CardOffer, random: Random = randomInt) {
  return shuffled(cards, random)
    .slice(0, pickCount)
    .map((card) => card.id);
}

export function isValidPick({ cards, pickCount }: CardOffer, cardIds: readonly string[]) {
  const offered = new Set(cards.map((card) => card.id));
  return (
    cardIds.length === pickCount &&
    new Set(cardIds).size === cardIds.length &&
    cardIds.every((id) => offered.has(id))
  );
}
