import { z } from 'zod';
import { CATEGORY_IDS } from '../categories.js';

const text = z.string().trim().min(1);
const categoryId = z.enum(CATEGORY_IDS);
const options = z
  .tuple([text, text, text, text])
  .refine((values) => new Set(values).size === values.length, 'Options must be unique');

const base = { id: text, category: categoryId, prompt: text };

export const mcQuestionSchema = z
  .object({ ...base, type: z.literal('mc'), options, answerIndex: z.literal(0) })
  .strict();

export const emojiQuestionSchema = z
  .object({ ...base, type: z.literal('emoji'), emoji: text, options, answerIndex: z.literal(0) })
  .strict();

export const tfQuestionSchema = z
  .object({ ...base, type: z.literal('tf'), answer: z.boolean() })
  .strict();

export const estimateQuestionSchema = z
  .object({
    ...base,
    type: z.literal('estimate'),
    answer: z.number().finite(),
    tolerance: z.number().finite().nonnegative(),
    unit: text,
  })
  .strict();

export const quizQuestionSchema = z.discriminatedUnion('type', [
  mcQuestionSchema,
  emojiQuestionSchema,
  tfQuestionSchema,
  estimateQuestionSchema,
]);

export const aynaRoundSchema = z.object({ id: text, category: categoryId, a: text, b: text }).strict();

export const cardLevelSchema = z.enum(['light', 'personal', 'bold']);

export const cardSchema = z
  .object({ id: text, category: categoryId, level: cardLevelSchema, text })
  .strict();

export const contentCategorySchema = z
  .object({ id: categoryId, name: text, emoji: text })
  .strict();

export const contentSchema = z
  .object({
    version: z.literal(2),
    categories: z.array(contentCategorySchema).length(CATEGORY_IDS.length),
    quiz: z.array(quizQuestionSchema),
    ayna: z.array(aynaRoundSchema),
    cards: z.array(cardSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const { id } of [...value.quiz, ...value.ayna, ...value.cards]) {
      if (seen.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate content id: ${id}` });
      }
      seen.add(id);
    }
  });

export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
export type McQuestion = z.infer<typeof mcQuestionSchema>;
export type EmojiQuestion = z.infer<typeof emojiQuestionSchema>;
export type TfQuestion = z.infer<typeof tfQuestionSchema>;
export type EstimateQuestion = z.infer<typeof estimateQuestionSchema>;
export type AynaRound = z.infer<typeof aynaRoundSchema>;
export type CardLevel = z.infer<typeof cardLevelSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Content = z.infer<typeof contentSchema>;
