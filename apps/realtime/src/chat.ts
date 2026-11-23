import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  SOCKET_ERROR_CODES,
  serverEventSchemas,
  type ChatMessage,
  type SocketErrorCode,
} from 'shared';
import { containsContactInfo, type WordFilter } from 'shared/filter';
import { RATE_RULES, type RateLimiter } from './ratelimit.js';

export const CHAT_TTL_SECONDS = 24 * 60 * 60;
export const SNAPSHOT_LIMIT = 50;

const MAX_STORED_MESSAGES = 1_000;
const MASKED_RULE = { name: 'masked', limit: 5, windowMs: 10 * 60 * 1000 };
const MUTE_SECONDS = 10 * 60;

export const messagesKey = (roomId: string) => `room:${roomId}:msgs`;
export const chatEndsAtKey = (roomId: string) => `room:${roomId}:chatEndsAt`;
export const muteKey = (userId: string) => `chat:mute:${userId}`;

export type PreparedMessage = { ok: true; body: string } | { ok: false; code: SocketErrorCode };

/** Random-chat message handling. Messages live only in Redis (SPEC §9). */
export class ChatService {
  constructor(
    private readonly redis: Redis,
    private readonly limiter: RateLimiter,
    private readonly filter: WordFilter,
  ) {}

  async prepare(userId: string, body: string, now = Date.now()): Promise<PreparedMessage> {
    if (await this.redis.exists(muteKey(userId))) {
      return { ok: false, code: SOCKET_ERROR_CODES.muted };
    }
    const withinSecond = await this.limiter.hit(RATE_RULES.chatPerSecond, userId, now);
    if (!withinSecond || !(await this.limiter.hit(RATE_RULES.chatBurst, userId, now))) {
      return { ok: false, code: SOCKET_ERROR_CODES.rateLimited };
    }
    if (containsContactInfo(body)) return { ok: false, code: SOCKET_ERROR_CODES.contactBlocked };

    const { text, masked } = this.filter.mask(body);
    if (masked) await this.recordMaskedMessage(userId, now);
    return { ok: true, body: text };
  }

  /** The fifth masked message in 10 minutes is still delivered, then the sender is muted. */
  private async recordMaskedMessage(userId: string, now: number) {
    const key = `rl:${MASKED_RULE.name}:${userId}`;
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', now - MASKED_RULE.windowMs)
      .zadd(key, now, randomUUID())
      .zcard(key)
      .pexpire(key, MASKED_RULE.windowMs)
      .exec();
    const count = Number(results?.[2]?.[1] ?? 0);
    if (count >= MASKED_RULE.limit) {
      await this.redis.multi().set(muteKey(userId), '1', 'EX', MUTE_SECONDS).del(key).exec();
    }
  }

  async store(roomId: string, senderId: string, body: string, at = new Date()) {
    const message: ChatMessage = { id: randomUUID(), senderId, body, at: at.toISOString() };
    const key = messagesKey(roomId);
    await this.redis
      .multi()
      .rpush(key, JSON.stringify(message))
      .ltrim(key, -MAX_STORED_MESSAGES, -1)
      .expire(key, CHAT_TTL_SECONDS)
      .exec();
    return message;
  }

  async markChatEnd(roomId: string, endsAt: number) {
    await this.redis.set(chatEndsAtKey(roomId), String(endsAt), 'EX', CHAT_TTL_SECONDS);
  }

  async history(roomId: string, limit = MAX_STORED_MESSAGES): Promise<ChatMessage[]> {
    const raw = await this.redis.lrange(messagesKey(roomId), -limit, -1);
    return raw.flatMap((entry) => {
      const parsed = serverEventSchemas['chat:message'].safeParse(JSON.parse(entry));
      return parsed.success ? [parsed.data] : [];
    });
  }

  snapshot(roomId: string) {
    return this.history(roomId, SNAPSHOT_LIMIT);
  }
}
