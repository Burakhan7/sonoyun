'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { CATEGORIES, ENGINES, type MatchFound } from 'shared';
import { Avatar } from '@/components/Avatar';

const ITEM_HEIGHT = 96;
const LOOPS = 3;
const SPIN_SECONDS = 2.6;

export function CategorySpin({ match }: { match: MatchFound }) {
  const reduceMotion = useReducedMotion();
  const targetIndex = CATEGORIES.findIndex((category) => category.id === match.category);
  const category = CATEGORIES[targetIndex]!;
  const engine = ENGINES[match.engine];
  const reel = Array.from({ length: LOOPS + 1 }, () => CATEGORIES).flat();
  const stopIndex = CATEGORIES.length * LOOPS + targetIndex;

  return (
    <div className="flex w-full flex-col items-center gap-5 text-center">
      <div className="flex items-center gap-2">
        <Avatar id={match.opponent.avatarId} size={44} />
        <span className="font-semibold">{match.opponent.nickname}</span>
      </div>

      <div
        aria-hidden="true"
        className="relative w-full max-w-xs overflow-hidden rounded-2xl border-2 border-ink bg-white"
        style={{ height: ITEM_HEIGHT }}
      >
        <motion.ul
          initial={{ y: reduceMotion ? -stopIndex * ITEM_HEIGHT : 0 }}
          animate={{ y: -stopIndex * ITEM_HEIGHT }}
          transition={{ duration: reduceMotion ? 0 : SPIN_SECONDS, ease: [0.12, 0.8, 0.2, 1] }}
        >
          {reel.map((item, index) => (
            <li
              key={`${item.id}-${index}`}
              className="flex items-center justify-center gap-3 px-2"
              style={{ height: ITEM_HEIGHT }}
            >
              <span className="text-4xl">{item.emoji}</span>
              <span className="truncate font-bold">{item.name}</span>
            </li>
          ))}
        </motion.ul>
      </div>

      <motion.div
        initial={{ opacity: reduceMotion ? 1 : 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduceMotion ? 0 : SPIN_SECONDS - 0.3 }}
      >
        <p className="sr-only">Kategori: {category.name}</p>
        <h2 className="text-xl font-bold">{engine.name}</h2>
        <p className="mt-1 text-sm text-muted">{match.rules}</p>
      </motion.div>
    </div>
  );
}
