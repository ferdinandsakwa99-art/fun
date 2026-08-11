import { redis, isRedisAvailable } from '../config/redis';

const PREFIX = 'cache:';

export const RedisService = {
  async get<T = any>(key: string): Promise<T | null> {
    try {
      if (!isRedisAvailable()) return null;
      const raw = await redis!.get(PREFIX + key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    } catch (err) {
      console.warn('[redis] get failed:', (err as Error).message);
      return null;
    }
  },

  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    try {
      if (!isRedisAvailable()) return;
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlSeconds > 0) {
        await redis!.setEx(PREFIX + key, ttlSeconds, raw);
      } else {
        await redis!.set(PREFIX + key, raw);
      }
    } catch (err) {
      console.warn('[redis] set failed:', (err as Error).message);
    }
  },

  async delete(key: string): Promise<void> {
    try {
      if (!isRedisAvailable()) return;
      await redis!.del(PREFIX + key);
    } catch (err) {
      console.warn('[redis] delete failed:', (err as Error).message);
    }
  },

  async deleteByPrefix(prefix: string): Promise<void> {
    try {
      if (!isRedisAvailable()) return;
      const pattern = `${PREFIX}${prefix}*`;
      let cursor = '0';
      do {
        const res = await redis!.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = res.cursor;
        if (res.keys.length) await redis!.del(res.keys);
      } while (cursor !== '0');
    } catch (err) {
      console.warn('[redis] deleteByPrefix failed:', (err as Error).message);
    }
  },
};

export default RedisService;
