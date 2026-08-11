import { redis } from '../config/redis';

export const RedisService = {
  get: async (key: string) => redis.get(key),
  set: async (key: string, value: string) => redis.set(key, value),
};
