import { createClient } from 'redis';
import { REDIS_URL } from './env';

export const redis = REDIS_URL ? createClient({ url: REDIS_URL }) : null;

if (redis) {
  redis.on('error', (err) => console.warn('[redis] error:', err.message));
  redis
    .connect()
    .catch((err) => console.warn('[redis] connect failed:', err.message));
}

export const isRedisAvailable = () => !!redis && redis.isReady;
