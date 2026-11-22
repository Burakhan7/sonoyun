import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_IDS } from '../index.js';
import * as publicEntry from '../index.js';
import { content, contentSchema } from './index.js';

const countBy = <T>(items: readonly T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});

describe('questions.json', () => {
  it('matches the totals in SPEC §8', () => {
    expect(content.quiz).toHaveLength(600);
    expect(content.ayna).toHaveLength(340);
    expect(content.cards).toHaveLength(480);
    expect(content.categories).toEqual(CATEGORIES);
  });

  it.each(CATEGORY_IDS)('has the expected content for %s', (category) => {
    const isAynaOnly = category === 'yasaydi';
    const quiz = content.quiz.filter((question) => question.category === category);
    const ayna = content.ayna.filter((round) => round.category === category);
    const cards = content.cards.filter((card) => card.category === category);

    expect(countBy(quiz, (question) => question.type)).toEqual(
      isAynaOnly ? {} : { mc: 12, tf: 12, estimate: 8, emoji: 8 },
    );
    expect(ayna).toHaveLength(isAynaOnly ? 40 : 20);
    expect(countBy(cards, (card) => card.level)).toEqual({ light: 10, personal: 10, bold: 10 });
  });

  it('keeps the correct option at index 0 in the source data', () => {
    for (const question of content.quiz) {
      if (question.type === 'mc' || question.type === 'emoji') {
        expect(question.answerIndex).toBe(0);
      }
    }
  });

  it('rejects a non-zero answerIndex and duplicate ids', () => {
    const question = content.quiz.find((item) => item.type === 'mc');
    expect(question).toBeDefined();

    expect(
      contentSchema.safeParse({ ...content, quiz: [{ ...question, answerIndex: 1 }] }).success,
    ).toBe(false);
    expect(contentSchema.safeParse({ ...content, quiz: [question, question] }).success).toBe(false);
  });

  it('does not expose content through the client-safe entry point', () => {
    expect(Object.keys(publicEntry)).not.toContain('content');
    expect(Object.keys(publicEntry)).not.toContain('contentSchema');
  });
});

describe('avatars', () => {
  it('matches the 24 animals and 30 adjectives in SPEC §18', () => {
    expect(new Set(publicEntry.AVATAR_IDS).size).toBe(24);
    expect(new Set(publicEntry.ADJECTIVES).size).toBe(30);
  });
});
