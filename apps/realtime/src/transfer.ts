import { randomInt } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

// Excludes 0/O and 1/I, which are easy to confuse (SPEC §4).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 5;
export const TRANSFER_CODE_TTL_MS = 10 * 60 * 1000;

export function generateTransferCode(random: (max: number) => number = randomInt) {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[random(ALPHABET.length)]).join('');
}

export const formatTransferCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const normalizeTransferCode = (input: string) =>
  input.toUpperCase().replace(/[^A-Z0-9]/g, '');

export class TransferService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Creates a fresh code and invalidates the user's earlier unused codes. */
  async create(userId: string, now = new Date()) {
    await this.prisma.transferCode.deleteMany({ where: { userId, usedAt: null } });
    const expiresAt = new Date(now.getTime() + TRANSFER_CODE_TTL_MS);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const code = generateTransferCode();
      try {
        await this.prisma.transferCode.create({ data: { code, userId, expiresAt } });
        return { code: formatTransferCode(code), expiresAt };
      } catch (error) {
        const isCollision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isCollision) throw error;
      }
    }
    throw new Error('Could not generate a unique transfer code');
  }

  /** Atomically consumes a code. Returns its user, or null if invalid, expired or used. */
  async redeem(input: string, now = new Date()): Promise<string | null> {
    const code = normalizeTransferCode(input);
    if (code.length !== CODE_LENGTH) return null;

    const { count } = await this.prisma.transferCode.updateMany({
      where: { code, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;
    const row = await this.prisma.transferCode.findUnique({ where: { code } });
    return row?.userId ?? null;
  }
}
