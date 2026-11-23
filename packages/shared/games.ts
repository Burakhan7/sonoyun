export const ENGINE_IDS = ['mc', 'emoji', 'estimate', 'tf', 'mixed', 'ayna'] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export interface EngineDefinition {
  id: EngineId;
  name: string;
  rule: string;
  rounds: number;
  /** Null when each round uses the time limit of its own question type. */
  roundSeconds: number | null;
}

export const ENGINES: Record<EngineId, EngineDefinition> = {
  mc: {
    id: 'mc',
    name: 'Hızlı Bilgi',
    rule: '4 şıktan doğruyu bul; ne kadar hızlıysan o kadar puan.',
    rounds: 5,
    roundSeconds: 12,
  },
  emoji: {
    id: 'emoji',
    name: 'Emoji Tahmin',
    rule: 'Emojilerin anlattığını 4 şık arasından bul.',
    rounds: 5,
    roundSeconds: 15,
  },
  estimate: {
    id: 'estimate',
    name: 'Yaklaşık',
    rule: 'Bir sayı tahmin et; doğruya daha yakın olan turu alır.',
    rounds: 3,
    roundSeconds: 15,
  },
  tf: {
    id: 'tf',
    name: 'Doğru mu Yanlış mı',
    rule: 'İfadeye hızlıca karar ver; önce doğru bilen bonus alır.',
    rounds: 7,
    roundSeconds: 6,
  },
  mixed: {
    id: 'mixed',
    name: 'Karışık Tur',
    rule: 'Her turda farklı bir soru tipi var; turu kazanan 1 puan alır.',
    rounds: 5,
    roundSeconds: null,
  },
  ayna: {
    id: 'ayna',
    name: 'Ayna',
    rule: 'Kendi seçimini yap ve rakibinin ne seçeceğini tahmin et.',
    rounds: 5,
    roundSeconds: 10,
  },
};

/** A category needs at least this many items of a type before an engine can use it (SPEC §8). */
export const MIN_CONTENT_PER_ENGINE = 8;
