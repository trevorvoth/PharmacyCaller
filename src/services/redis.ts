import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some(e => err.message.includes(e));
    },
  });

  client.on('connect', () => {
    logger.info('Redis client connected');
  });

  client.on('error', (err) => {
    logger.error({ err }, 'Redis client error');
  });

  client.on('close', () => {
    logger.warn('Redis client connection closed');
  });

  client.on('reconnecting', () => {
    logger.info('Redis client reconnecting');
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

// Helper functions for common Redis operations
export const redisHelpers = {
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const json = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, json);
    } else {
      await redis.set(key, json);
    }
  },

  async getJson<T>(key: string): Promise<T | null> {
    const value = await redis.get(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value) as T;
  },

  async deleteKey(key: string): Promise<void> {
    await redis.del(key);
  },

  async setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void> {
    await redis.setex(key, ttlSeconds, value);
  },

  async increment(key: string): Promise<number> {
    return redis.incr(key);
  },

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await redis.expire(key, ttlSeconds);
  },
};

export type { Redis };
