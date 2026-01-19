import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/db/client.js';
import { redis } from '../../src/services/redis.js';
import { logger } from '../../src/utils/logger.js';
import { testSentryConnection } from '../../src/utils/sentry.js';
import { metrics, METRICS } from '../../src/services/metrics.js';

describe('Batch 1 Verification', () => {
  beforeAll(async () => {
    // Wait for connections
    await prisma.$connect();
    await redis.ping();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('Database Connection', () => {
    it('should connect to PostgreSQL', async () => {
      const result = await prisma.$queryRaw<[{ result: number }]>`SELECT 1 as result`;
      expect(result[0]?.result).toBe(1);
    });

    it('should have User model defined', async () => {
      // This will throw if the model doesn't exist
      const count = await prisma.user.count();
      expect(typeof count).toBe('number');
    });

    it('should have Call model defined', async () => {
      const count = await prisma.call.count();
      expect(typeof count).toBe('number');
    });

    it('should have PharmacySearch model defined', async () => {
      const count = await prisma.pharmacySearch.count();
      expect(typeof count).toBe('number');
    });

    it('should have PharmacyResult model defined', async () => {
      const count = await prisma.pharmacyResult.count();
      expect(typeof count).toBe('number');
    });
  });

  describe('Redis Connection', () => {
    it('should connect to Redis', async () => {
      const pong = await redis.ping();
      expect(pong).toBe('PONG');
    });

    it('should set and get values', async () => {
      const testKey = 'test:batch1:verification';
      const testValue = 'hello-pharmacycaller';

      await redis.set(testKey, testValue);
      const result = await redis.get(testKey);
      await redis.del(testKey);

      expect(result).toBe(testValue);
    });

    it('should support expiry', async () => {
      const testKey = 'test:batch1:expiry';
      await redis.setex(testKey, 1, 'expires-soon');

      const ttl = await redis.ttl(testKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1);

      await redis.del(testKey);
    });
  });

  describe('Logger', () => {
    it('should log messages without throwing', () => {
      expect(() => {
        logger.info('Test info message');
        logger.warn('Test warning message');
        logger.debug('Test debug message');
      }).not.toThrow();
    });

    it('should log objects', () => {
      expect(() => {
        logger.info({ test: 'data', nested: { value: 123 } }, 'Test with object');
      }).not.toThrow();
    });
  });

  describe('Metrics', () => {
    it('should increment counters', async () => {
      const testMetric = METRICS.CALLS_INITIATED;
      const before = await metrics.get(testMetric);

      await metrics.increment(testMetric);
      const after = await metrics.get(testMetric);

      expect(after).toBe(before + 1);
    });

    it('should set gauge values', async () => {
      const testMetric = METRICS.ACTIVE_USERS;
      await metrics.set(testMetric, 42);

      const value = await metrics.get(testMetric);
      expect(value).toBe(42);
    });

    it('should get daily stats', async () => {
      const stats = await metrics.getDailyStats();
      expect(typeof stats).toBe('object');
      expect('CALLS_INITIATED' in stats).toBe(true);
    });
  });

  describe('Sentry', () => {
    it('should initialize without throwing', () => {
      // Sentry is initialized in server.ts
      // This test just verifies the module loads correctly
      expect(testSentryConnection).toBeDefined();
    });

    // Note: Full Sentry test requires SENTRY_DSN to be configured
    // In CI, we can test that it handles missing DSN gracefully
  });
});
