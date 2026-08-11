import { RedisService } from '../services/redis.service';

export const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - start;
    if (ms >= 10) console.log(`[timing] ${label} took ${ms}ms`);
  }
};

export const cachedFetch = async <T>(
  key: string,
  ttl: number,
  fetch: () => Promise<T>,
): Promise<T> => {
  const cached = await RedisService.get<T>(key);
  if (cached !== null) return cached;

  const data = await timed(`cache-miss:${key}`, fetch);
  await RedisService.set(key, data, ttl);
  return data;
};

export const invalidate = async (...prefixes: string[]) => {
  await Promise.all(prefixes.map((prefix) => RedisService.deleteByPrefix(prefix)));
};
