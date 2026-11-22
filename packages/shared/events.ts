import { z } from 'zod';
import { AVATAR_IDS } from './avatars.js';
import { CATEGORY_IDS } from './categories.js';
import { ENGINE_IDS } from './games.js';

export const handshakeAuthSchema = z.object({ token: z.string().min(1).max(2048) });

export const SOCKET_AUTH_ERRORS = {
  unauthorized: 'unauthorized',
  banned: 'banned',
  internal: 'internal',
} as const;

export const SOCKET_ERROR_CODES = {
  invalidPayload: 'invalid_payload',
  unauthorized: 'unauthorized',
  banned: 'banned',
  termsRequired: 'terms_required',
  alreadyQueued: 'already_queued',
  inRoom: 'in_room',
  internal: 'internal',
} as const;

const id = z.string().min(1).max(64);
const timestamp = z.string().datetime();
const messageBody = z.string().trim().min(1).max(500);
const empty = z.object({}).strict();
const scores = z.record(id, z.number().int());

export const REPORT_REASONS = ['taciz', 'kufur', 'spam', 'reşit-olmayan', 'diger'] as const;

export const publicCardSchema = z
  .object({
    id,
    category: z.enum(CATEGORY_IDS),
    level: z.enum(['light', 'personal', 'bold']),
    text: z.string().min(1),
  })
  .strict();

export const opponentSchema = z
  .object({ id, nickname: z.string().min(1), avatarId: z.enum(AVATAR_IDS) })
  .strict();

const options = z.tuple([z.string(), z.string(), z.string(), z.string()]);

/** Strict on purpose: a question sent before round:result can never carry its answer. */
export const publicQuestionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mc'), id, prompt: z.string(), options }).strict(),
  z
    .object({ type: z.literal('emoji'), id, prompt: z.string(), emoji: z.string(), options })
    .strict(),
  z.object({ type: z.literal('tf'), id, prompt: z.string() }).strict(),
  z.object({ type: z.literal('estimate'), id, prompt: z.string(), unit: z.string() }).strict(),
  z.object({ type: z.literal('ayna'), id, a: z.string(), b: z.string() }).strict(),
]);

export const clientEventSchemas = {
  'queue:join': empty,
  'queue:leave': empty,
  'game:answer': z
    .object({
      roundNo: z.number().int().positive(),
      answer: z.union([z.string().max(64), z.number().finite()]),
      prediction: z.enum(['a', 'b']).optional(),
    })
    .strict(),
  'cards:pick': z.object({ cardIds: z.array(id).min(1).max(2) }).strict(),
  'chat:send': z.object({ body: messageBody }).strict(),
  'chat:typing': empty,
  'chat:leave': empty,
  'friend:request': z.object({ userId: id }).strict(),
  'friend:respond': z.object({ requestId: id, accept: z.boolean() }).strict(),
  'dm:send': z.object({ conversationId: id, body: messageBody }).strict(),
  'dm:read': z.object({ conversationId: id }).strict(),
  'user:block': z.object({ userId: id }).strict(),
  'user:report': z
    .object({ userId: id, reason: z.enum(REPORT_REASONS), note: z.string().max(300).optional() })
    .strict(),
  'invite:create': z.object({ friendId: id }).strict(),
} as const;

export const onlineCountSchema = z
  .object({
    online: z.number().int().nonnegative(),
    activeGames: z.number().int().nonnegative(),
    gamesToday: z.number().int().nonnegative(),
  })
  .strict();

export const serverEventSchemas = {
  'online:count': onlineCountSchema,
  'queue:status': z.object({ waitingSec: z.number().int().nonnegative() }).strict(),
  'match:found': z
    .object({
      roomId: id,
      opponent: opponentSchema,
      category: z.enum(CATEGORY_IDS),
      engine: z.enum(ENGINE_IDS),
      rules: z.string().min(1),
    })
    .strict(),
  'round:start': z
    .object({
      roundNo: z.number().int().positive(),
      total: z.number().int().positive(),
      question: publicQuestionSchema,
      endsAt: timestamp,
    })
    .strict(),
  'round:result': z
    .object({
      roundNo: z.number().int().positive(),
      correct: z.union([z.number(), z.boolean(), z.null()]),
      answers: z.record(id, z.unknown()),
      scores,
    })
    .strict(),
  'game:over': z
    .object({
      winnerId: id.nullable(),
      scores,
      harmony: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  'cards:offer': z
    .object({
      cards: z.array(publicCardSchema),
      pickCount: z.number().int().positive(),
      endsAt: timestamp,
    })
    .strict(),
  'chat:start': z
    .object({
      pinned: z.array(z.object({ byUserId: id, card: publicCardSchema }).strict()),
      endsAt: timestamp,
    })
    .strict(),
  'chat:message': z.object({ id, senderId: id, body: z.string(), at: timestamp }).strict(),
  'chat:typing': z.object({ userId: id }).strict(),
  'chat:ended': z.object({ reason: z.enum(['timeout', 'left', 'disconnect']) }).strict(),
  'friend:incoming': z.object({ requestId: id, from: opponentSchema }).strict(),
  'friend:accepted': z.object({ userId: id, conversationId: id }).strict(),
  'dm:message': z
    .object({
      conversationId: id,
      message: z.object({ id, senderId: id, body: z.string(), at: timestamp }).strict(),
    })
    .strict(),
  error: z.object({ code: z.string().min(1), message: z.string() }).strict(),
} as const;

type ClientSchemas = typeof clientEventSchemas;
type ServerSchemas = typeof serverEventSchemas;

export type ClientEventPayload<E extends keyof ClientSchemas> = z.input<ClientSchemas[E]>;
export type ServerEventPayload<E extends keyof ServerSchemas> = z.infer<ServerSchemas[E]>;

export type ClientToServerEvents = {
  [E in keyof ClientSchemas]: (payload: ClientEventPayload<E>) => void;
};

export type ServerToClientEvents = {
  [E in keyof ServerSchemas]: (payload: ServerEventPayload<E>) => void;
};

export type OnlineCount = z.infer<typeof onlineCountSchema>;
export type MatchFound = ServerEventPayload<'match:found'>;
export type Opponent = z.infer<typeof opponentSchema>;
export type PublicQuestion = z.infer<typeof publicQuestionSchema>;
export type PublicCard = z.infer<typeof publicCardSchema>;
