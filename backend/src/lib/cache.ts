import { Redis } from '@upstash/redis';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('[cache] Upstash not configured — caching disabled.');
    return null;
  }
  client = new Redis({ url, token });
  return client;
}

/** Cache-aside helper. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const r = getRedis();
  if (!r) return loader();
  try {
    const hit = await r.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch (err) {
    console.warn('[cache] read failed:', (err as Error).message);
  }
  const value = await loader();
  try {
    await r.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.warn('[cache] write failed:', (err as Error).message);
  }
  return value;
}
