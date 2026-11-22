import { z } from 'zod';
import { AVATAR_IDS } from './avatars.js';

export const publicUserSchema = z
  .object({
    id: z.string().min(1),
    nickname: z.string().min(1),
    avatarId: z.enum(AVATAR_IDS),
    termsAccepted: z.boolean(),
    nextIdentityRefreshAt: z.string().datetime().nullable(),
    bannedUntil: z.string().datetime().nullable(),
  })
  .strict();

export const guestResponseSchema = z
  .object({ token: z.string().min(1), user: publicUserSchema })
  .strict();

export const userResponseSchema = z.object({ user: publicUserSchema }).strict();

export const identityLimitResponseSchema = z
  .object({
    code: z.literal('identity_refresh_limit'),
    nextIdentityRefreshAt: z.string().datetime(),
  })
  .strict();

export type PublicUser = z.infer<typeof publicUserSchema>;
export type GuestResponse = z.infer<typeof guestResponseSchema>;
