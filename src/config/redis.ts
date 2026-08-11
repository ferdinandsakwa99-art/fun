import { REDIS_URL } from './env';

const Redis = require('ioredis');

export const redis = new Redis(REDIS_URL);
