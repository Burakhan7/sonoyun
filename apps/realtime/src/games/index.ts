import type { EngineId } from 'shared';
import { aynaEngine } from './ayna.js';
import { emojiEngine } from './emoji.js';
import type { GameEngine } from './engine.js';
import { estimateEngine } from './estimate.js';
import { mcEngine } from './mc.js';
import { mixedEngine } from './mixed.js';
import { tfEngine } from './tf.js';

export const GAME_ENGINES: Record<EngineId, GameEngine> = {
  mc: mcEngine,
  emoji: emojiEngine,
  estimate: estimateEngine,
  tf: tfEngine,
  mixed: mixedEngine,
  ayna: aynaEngine,
};
