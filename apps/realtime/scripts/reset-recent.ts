// Development helper: clears "last 20 opponents" so the same local browsers can match again.
import { Redis } from 'ioredis';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

if (process.env.NODE_ENV === 'production' || !LOCAL_HOSTS.has(new URL(url).hostname)) {
  console.error('Bu komut yalnızca yerel geliştirme Redis’inde çalışır.');
  process.exit(1);
}

const redis = new Redis(url);
let cursor = '0';
let removed = 0;

do {
  const [next, keys] = await redis.scan(cursor, 'MATCH', 'mm:recent:*', 'COUNT', 200);
  cursor = next;
  if (keys.length > 0) removed += await redis.del(...keys);
} while (cursor !== '0');

redis.disconnect();
console.log(`Son rakip listeleri temizlendi (${removed} kullanıcı).`);
