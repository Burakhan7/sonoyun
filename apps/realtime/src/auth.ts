import { SignJWT, jwtVerify } from 'jose';

const ALGORITHM = 'HS256';
const TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

export interface TokenService {
  sign(userId: string): Promise<string>;
  verify(token: string): Promise<string | null>;
}

export function createTokenService(secret: string): TokenService {
  const key = new TextEncoder().encode(secret);

  return {
    sign(userId) {
      // One clock reading, so the lifetime stays exact across a second boundary.
      const issuedAt = Math.floor(Date.now() / 1000);
      return new SignJWT()
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(userId)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + TOKEN_LIFETIME_SECONDS)
        .sign(key);
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: [ALGORITHM] });
        return payload.sub ?? null;
      } catch {
        return null;
      }
    },
  };
}

export function readBearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer (\S+)$/);
  return match?.[1] ?? null;
}
