import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ADJECTIVES, AVATARS, publicUserSchema, type AvatarId, type PublicUser } from 'shared';

export const IDENTITY_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface Identity {
  nickname: string;
  avatarId: AvatarId;
}

export interface UserRecord {
  id: string;
  nickname: string;
  avatarId: string;
  acceptedTermsAt: Date | null;
  nicknameChangedAt: Date | null;
  bannedUntil: Date | null;
  deviceHash?: string | null;
}

export interface UserStore {
  create(identity: Identity): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  touch(id: string, now: Date): Promise<void>;
  acceptTerms(id: string, now: Date): Promise<void>;
  /** Keeps the latest device summary so a banned person is easier to recognise (SPEC §4). */
  recordDevice(id: string, deviceHash: string): Promise<void>;
  /** Applies the identity only if it was last changed at or before `cutoff`. */
  refreshIdentity(id: string, identity: Identity, cutoff: Date, now: Date): Promise<boolean>;
}

export function randomIdentity(current?: string): Identity {
  for (;;) {
    const avatar = AVATARS[randomInt(AVATARS.length)]!;
    const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
    const nickname = `${adjective} ${avatar.name}`;
    if (nickname !== current) return { nickname, avatarId: avatar.id };
  }
}

export function isBanned(user: Pick<UserRecord, 'bannedUntil'>, now: Date): boolean {
  return user.bannedUntil !== null && user.bannedUntil > now;
}

export function nextIdentityRefreshAt(user: Pick<UserRecord, 'nicknameChangedAt'>, now: Date) {
  if (!user.nicknameChangedAt) return null;
  const next = new Date(user.nicknameChangedAt.getTime() + IDENTITY_REFRESH_MS);
  return next > now ? next : null;
}

export function toPublicUser(user: UserRecord, now: Date): PublicUser {
  return publicUserSchema.parse({
    id: user.id,
    nickname: user.nickname,
    avatarId: user.avatarId,
    termsAccepted: user.acceptedTermsAt !== null,
    nextIdentityRefreshAt: nextIdentityRefreshAt(user, now)?.toISOString() ?? null,
    bannedUntil: isBanned(user, now) ? user.bannedUntil!.toISOString() : null,
  });
}

export function createPrismaUserStore(prisma: PrismaClient): UserStore {
  return {
    create: (identity) => prisma.user.create({ data: identity }),
    findById: (id) => prisma.user.findUnique({ where: { id } }),

    async touch(id, now) {
      await prisma.user.updateMany({ where: { id }, data: { lastSeenAt: now } });
    },

    async acceptTerms(id, now) {
      await prisma.user.updateMany({
        where: { id, acceptedTermsAt: null },
        data: { acceptedTermsAt: now },
      });
    },

    async recordDevice(id, deviceHash) {
      await prisma.user.updateMany({ where: { id }, data: { deviceHash } });
    },

    async refreshIdentity(id, identity, cutoff, now) {
      const { count } = await prisma.user.updateMany({
        where: { id, OR: [{ nicknameChangedAt: null }, { nicknameChangedAt: { lte: cutoff } }] },
        data: { ...identity, nicknameChangedAt: now },
      });
      return count === 1;
    },
  };
}
