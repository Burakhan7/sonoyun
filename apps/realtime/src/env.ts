import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3100'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    MATCH_ALLOW_SAME_IP: booleanFlag,
    TRUST_PROXY: booleanFlag,
    INTERNAL_API_SECRET: z.string().min(32).optional(),
    SENTRY_DSN: z.string().url().optional(),
    GUEST_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.MATCH_ALLOW_SAME_IP, {
    message: 'MATCH_ALLOW_SAME_IP must not be enabled in production',
    path: ['MATCH_ALLOW_SAME_IP'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.INTERNAL_API_SECRET), {
    message: 'INTERNAL_API_SECRET is required in production',
    path: ['INTERNAL_API_SECRET'],
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
