import { z } from 'zod';
import { AVATAR_IDS } from './avatars.js';
import { CATEGORY_IDS } from './categories.js';

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

const person = {
  id: z.string().min(1),
  nickname: z.string().min(1),
  avatarId: z.enum(AVATAR_IDS),
};

export const friendSchema = z
  .object({ ...person, online: z.boolean(), conversationId: z.string().nullable() })
  .strict();

export const friendRequestSchema = z
  .object({ requestId: z.string().min(1), user: z.object(person).strict() })
  .strict();

export const friendsResponseSchema = z
  .object({
    friends: z.array(friendSchema),
    incoming: z.array(friendRequestSchema),
    outgoing: z.array(friendRequestSchema),
  })
  .strict();

export const directMessageSchema = z
  .object({
    id: z.string().min(1),
    senderId: z.string().min(1),
    body: z.string(),
    at: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const conversationSummarySchema = z
  .object({
    id: z.string().min(1),
    friend: z.object({ ...person, online: z.boolean() }).strict(),
    lastMessage: directMessageSchema.nullable(),
    unread: z.number().int().nonnegative(),
  })
  .strict();

export const conversationsResponseSchema = z
  .object({ conversations: z.array(conversationSummarySchema) })
  .strict();

export const messagesPageSchema = z
  .object({
    friend: z.object({ ...person, online: z.boolean() }).strict(),
    /** Category of the game where the two met, for the first system line (SPEC §9). */
    metInCategory: z.enum(CATEGORY_IDS).nullable(),
    messages: z.array(directMessageSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const unreadResponseSchema = z.object({ unread: z.number().int().nonnegative() }).strict();

export const transferCodeResponseSchema = z
  .object({
    code: z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const transferRedeemSchema = z.object({ code: z.string().min(8).max(16) }).strict();

export const deleteAccountSchema = z.object({ confirm: z.literal('SİL') }).strict();

export const ADMIN_REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export const adminReportStatusSchema = z.object({ status: z.enum(ADMIN_REPORT_STATUSES) }).strict();

export const adminBanSchema = z
  .object({
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365),
  })
  .strict();

export const adminReportSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string(),
    note: z.string().nullable(),
    status: z.string(),
    createdAt: z.string().datetime(),
    matchId: z.string().nullable(),
    priority: z.boolean(),
    snapshot: z.array(
      z.object({ id: z.string(), senderId: z.string(), body: z.string(), at: z.string() }),
    ),
    reporter: z.object({ id: z.string(), nickname: z.string().nullable() }).strict(),
    reported: z
      .object({
        id: z.string(),
        nickname: z.string().nullable(),
        bannedUntil: z.string().datetime().nullable(),
        suspended: z.boolean(),
        openReports: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const adminReportsResponseSchema = z
  .object({ reports: z.array(adminReportSchema) })
  .strict();

export const ADMIN_CHAT_KINDS = ['room', 'dm'] as const;

const adminChatPartySchema = z
  .object({
    id: z.string(),
    /** Null when the account was deleted. */
    nickname: z.string().nullable(),
    avatarId: z.enum(AVATAR_IDS).nullable(),
    bannedUntil: z.string().datetime().nullable(),
  })
  .strict();

const adminChatMessageSchema = z
  .object({ id: z.string(), senderId: z.string(), body: z.string(), at: z.string().datetime() })
  .strict();

export const adminChatSummarySchema = z
  .object({
    kind: z.enum(ADMIN_CHAT_KINDS),
    id: z.string().min(1),
    /** A game chat happening right now, or a DM with a message in the last few minutes. */
    live: z.boolean(),
    /** A friends' game room from an invite. Only known while the room is live. */
    friendly: z.boolean(),
    participants: z.array(adminChatPartySchema),
    startedAt: z.string().datetime().nullable(),
    lastMessageAt: z.string().datetime().nullable(),
    /** When a live random chat closes; null for DMs and untimed friends' rooms. */
    endsAt: z.string().datetime().nullable(),
    messageCount: z.number().int().nonnegative(),
    preview: adminChatMessageSchema.nullable(),
    reported: z.boolean(),
  })
  .strict();

export const adminChatsResponseSchema = z
  .object({ active: z.array(adminChatSummarySchema), stored: z.array(adminChatSummarySchema) })
  .strict();

export const adminChatDetailSchema = z
  .object({ chat: adminChatSummarySchema, messages: z.array(adminChatMessageSchema) })
  .strict();

export type AdminReport = z.infer<typeof adminReportSchema>;
export type AdminChatKind = (typeof ADMIN_CHAT_KINDS)[number];
export type AdminChatSummary = z.infer<typeof adminChatSummarySchema>;
export type AdminChatsResponse = z.infer<typeof adminChatsResponseSchema>;
export type AdminChatDetail = z.infer<typeof adminChatDetailSchema>;
export type Friend = z.infer<typeof friendSchema>;
export type FriendRequestEntry = z.infer<typeof friendRequestSchema>;
export type FriendsResponse = z.infer<typeof friendsResponseSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type MessagesPage = z.infer<typeof messagesPageSchema>;
export type TransferCodeResponse = z.infer<typeof transferCodeResponseSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type GuestResponse = z.infer<typeof guestResponseSchema>;
