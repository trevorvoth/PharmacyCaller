/**
 * Batch 6 Integration Tests: Pharmacy Tracking & API Routes
 *
 * Tests:
 * - 6.1: Pharmacy tracker service
 * - 6.2-6.5: Search endpoints
 * - 6.6-6.9: Call endpoints
 * - 6.10: Twilio Client token endpoint
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// ============================================
// 6.1: Pharmacy Tracker Service Tests
// ============================================
describe('Batch 6.1: Pharmacy Tracker Service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should export pharmacyTracker service', async () => {
    // Mock Redis before importing
    vi.doMock('../../src/services/redis.js', () => ({
      redis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        hset: vi.fn(),
        hget: vi.fn(),
        hgetall: vi.fn().mockResolvedValue({}),
        hdel: vi.fn(),
        expire: vi.fn(),
        publish: vi.fn(),
      },
      redisHelpers: {
        getJson: vi.fn(),
        setJson: vi.fn(),
      },
    }));

    const { pharmacyTracker } = await import('../../src/services/pharmacyTracker.js');
    expect(pharmacyTracker).toBeDefined();
  });

  it('should have initSearch method', async () => {
    vi.doMock('../../src/services/redis.js', () => ({
      redis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        hset: vi.fn(),
        hget: vi.fn(),
        hgetall: vi.fn().mockResolvedValue({}),
        hdel: vi.fn(),
        expire: vi.fn(),
        publish: vi.fn(),
      },
      redisHelpers: {
        getJson: vi.fn(),
        setJson: vi.fn(),
      },
    }));

    const { pharmacyTracker } = await import('../../src/services/pharmacyTracker.js');
    expect(typeof pharmacyTracker.initSearch).toBe('function');
  });

  it('should have updateFromCallState method', async () => {
    vi.doMock('../../src/services/redis.js', () => ({
      redis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        hset: vi.fn(),
        hget: vi.fn(),
        hgetall: vi.fn().mockResolvedValue({}),
        hdel: vi.fn(),
        expire: vi.fn(),
        publish: vi.fn(),
      },
      redisHelpers: {
        getJson: vi.fn(),
        setJson: vi.fn(),
      },
    }));

    const { pharmacyTracker } = await import('../../src/services/pharmacyTracker.js');
    expect(typeof pharmacyTracker.updateFromCallState).toBe('function');
  });

  it('should have markMedicationFound method', async () => {
    vi.doMock('../../src/services/redis.js', () => ({
      redis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        hset: vi.fn(),
        hget: vi.fn(),
        hgetall: vi.fn().mockResolvedValue({}),
        hdel: vi.fn(),
        expire: vi.fn(),
        publish: vi.fn(),
      },
      redisHelpers: {
        getJson: vi.fn(),
        setJson: vi.fn(),
      },
    }));

    const { pharmacyTracker } = await import('../../src/services/pharmacyTracker.js');
    expect(typeof pharmacyTracker.markMedicationFound).toBe('function');
  });

  it('should have getChecklist method', async () => {
    vi.doMock('../../src/services/redis.js', () => ({
      redis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        hset: vi.fn(),
        hget: vi.fn(),
        hgetall: vi.fn().mockResolvedValue({}),
        hdel: vi.fn(),
        expire: vi.fn(),
        publish: vi.fn(),
      },
      redisHelpers: {
        getJson: vi.fn(),
        setJson: vi.fn(),
      },
    }));

    const { pharmacyTracker } = await import('../../src/services/pharmacyTracker.js');
    expect(typeof pharmacyTracker.getChecklist).toBe('function');
  });

  it('should have getReadyPharmacies method', async () => {
    vi.doMock('../../src/services/redis.js', () => ({
      redis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        hset: vi.fn(),
        hget: vi.fn(),
        hgetall: vi.fn().mockResolvedValue({}),
        hdel: vi.fn(),
        expire: vi.fn(),
        publish: vi.fn(),
      },
      redisHelpers: {
        getJson: vi.fn(),
        setJson: vi.fn(),
      },
    }));

    const { pharmacyTracker } = await import('../../src/services/pharmacyTracker.js');
    expect(typeof pharmacyTracker.getReadyPharmacies).toBe('function');
  });
});

// ============================================
// 6.2-6.5: Search Routes Tests
// ============================================
describe('Batch 6.2-6.5: Search Routes', () => {
  it('should export searchRoutes function', async () => {
    const { searchRoutes } = await import('../../src/routes/searches.js');
    expect(typeof searchRoutes).toBe('function');
  });
});

// ============================================
// 6.6-6.9: Call Routes Tests
// ============================================
describe('Batch 6.6-6.9: Call Routes', () => {
  it('should export callRoutes function', async () => {
    const { callRoutes } = await import('../../src/routes/calls.js');
    expect(typeof callRoutes).toBe('function');
  });
});

// ============================================
// 6.10: Token Route Tests
// ============================================
describe('Batch 6.10: Token Route', () => {
  it('should export tokenRoutes function', async () => {
    const { tokenRoutes } = await import('../../src/routes/token.js');
    expect(typeof tokenRoutes).toBe('function');
  });

  it('should have generateAccessToken in twilio client', async () => {
    const { generateAccessToken } = await import('../../src/services/twilio/client.js');
    expect(typeof generateAccessToken).toBe('function');
  });
});

// ============================================
// Integration: Route Registration Tests
// ============================================
describe('Batch 6: Route Registration in Server', () => {
  it('should import searchRoutes in server', async () => {
    // Just verify the import doesn't throw
    const { searchRoutes } = await import('../../src/routes/searches.js');
    expect(searchRoutes).toBeDefined();
  });

  it('should import callRoutes in server', async () => {
    const { callRoutes } = await import('../../src/routes/calls.js');
    expect(callRoutes).toBeDefined();
  });

  it('should import tokenRoutes in server', async () => {
    const { tokenRoutes } = await import('../../src/routes/token.js');
    expect(tokenRoutes).toBeDefined();
  });
});

// ============================================
// PharmacyCallStatus Enum Tests (from Prisma)
// ============================================
describe('Batch 6: PharmacyCallStatus', () => {
  it('should have required status values in Prisma enum', async () => {
    // PharmacyCallStatus comes from Prisma, verify it has expected values
    const { PharmacyCallStatus } = await import('@prisma/client');
    expect(PharmacyCallStatus).toBeDefined();
    expect(PharmacyCallStatus.PENDING).toBe('PENDING');
    expect(PharmacyCallStatus.CALLING).toBe('CALLING');
    expect(PharmacyCallStatus.READY).toBe('READY'); // Human or voicemail ready
    expect(PharmacyCallStatus.CONNECTED).toBe('CONNECTED');
    expect(PharmacyCallStatus.COMPLETED).toBe('COMPLETED');
    expect(PharmacyCallStatus.FAILED).toBe('FAILED');
  });
});
