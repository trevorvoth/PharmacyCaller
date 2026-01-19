import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../src/db/client.js';
import { redis } from '../../src/services/redis.js';
import { registerAuthHook } from '../../src/middleware/auth.js';
import { authRoutes } from '../../src/routes/auth.js';
import { pharmacyRoutes } from '../../src/routes/pharmacies.js';
import { defaultRateLimit } from '../../src/middleware/rateLimit.js';
import { hashPassword } from '../../src/utils/password.js';
import { generateToken } from '../../src/utils/jwt.js';

describe('Batch 2: Authentication & Security', () => {
  let app: FastifyInstance;
  let testUserId: string;
  let testToken: string;

  beforeAll(async () => {
    // Create test app
    app = Fastify();
    registerAuthHook(app);
    await app.register(authRoutes);
    await app.register(pharmacyRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    // Clean up test users
    await prisma.user.deleteMany({
      where: { email: { contains: '@test.pharmacycaller.com' } },
    });
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(async () => {
    // Clean up test data between tests
    await prisma.user.deleteMany({
      where: { email: { contains: '@test.pharmacycaller.com' } },
    });
  });

  describe('User Signup (POST /auth/signup)', () => {
    it('should create a new user with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'newuser@test.pharmacycaller.com',
          password: 'SecurePass123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('newuser@test.pharmacycaller.com');
      expect(body.token).toBeDefined();
      expect(body.user.password).toBeUndefined();
    });

    it('should reject weak passwords', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'weakpass@test.pharmacycaller.com',
          password: 'weakpass', // 8 chars but no uppercase/number
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('weak');
    });

    it('should reject duplicate emails', async () => {
      // Create first user
      await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'duplicate@test.pharmacycaller.com',
          password: 'SecurePass123',
        },
      });

      // Try to create duplicate
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'duplicate@test.pharmacycaller.com',
          password: 'SecurePass456',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('already registered');
    });

    it('should reject invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'not-an-email',
          password: 'SecurePass123',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('User Login (POST /auth/login)', () => {
    beforeEach(async () => {
      // Create a test user for login tests
      const hashedPassword = await hashPassword('TestPassword123');
      const user = await prisma.user.create({
        data: {
          email: 'login@test.pharmacycaller.com',
          password: hashedPassword,
        },
      });
      testUserId = user.id;
    });

    it('should login with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'login@test.pharmacycaller.com',
          password: 'TestPassword123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe('login@test.pharmacycaller.com');
    });

    it('should reject invalid password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'login@test.pharmacycaller.com',
          password: 'WrongPassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid');
    });

    it('should reject non-existent email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'nonexistent@test.pharmacycaller.com',
          password: 'SomePassword123',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Auth Middleware (GET /auth/me)', () => {
    beforeEach(async () => {
      const hashedPassword = await hashPassword('TestPassword123');
      const user = await prisma.user.create({
        data: {
          email: 'authtest@test.pharmacycaller.com',
          password: hashedPassword,
        },
      });
      testUserId = user.id;
      testToken = generateToken({ userId: user.id, email: user.email });
    });

    it('should return user info with valid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('authtest@test.pharmacycaller.com');
      expect(body.user.dailySearchLimit).toBe(10);
    });

    it('should reject request without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer invalid-token-here',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Rate Limiting', () => {
    it('should add rate limit headers', async () => {
      const testApp = Fastify();
      testApp.addHook('onRequest', defaultRateLimit);
      testApp.get('/test', async () => ({ ok: true }));
      await testApp.ready();

      const response = await testApp.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();

      await testApp.close();
    });
  });

  describe('User Search Limits', () => {
    beforeEach(async () => {
      const hashedPassword = await hashPassword('TestPassword123');
      const user = await prisma.user.create({
        data: {
          email: 'searchlimit@test.pharmacycaller.com',
          password: hashedPassword,
          dailySearchCount: 9, // One search remaining
          lastSearchDate: new Date(),
        },
      });
      testUserId = user.id;
      testToken = generateToken({ userId: user.id, email: user.email });
    });

    it('should track search count in user profile', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.dailySearchCount).toBe(9);
      expect(body.user.dailySearchLimit).toBe(10);
    });
  });

  describe('Password Utilities', () => {
    it('should validate password strength correctly', async () => {
      const { validatePasswordStrength } = await import('../../src/utils/password.js');

      // Weak password
      const weak = validatePasswordStrength('weak');
      expect(weak.valid).toBe(false);
      expect(weak.errors.length).toBeGreaterThan(0);

      // Strong password
      const strong = validatePasswordStrength('SecurePass123');
      expect(strong.valid).toBe(true);
      expect(strong.errors.length).toBe(0);
    });

    it('should hash and verify passwords', async () => {
      const { hashPassword, verifyPassword } = await import('../../src/utils/password.js');

      const password = 'MySecurePassword123';
      const hashed = await hashPassword(password);

      expect(hashed).not.toBe(password);
      expect(await verifyPassword(password, hashed)).toBe(true);
      expect(await verifyPassword('wrong', hashed)).toBe(false);
    });
  });

  describe('JWT Utilities', () => {
    it('should generate and verify tokens', async () => {
      const { generateToken, verifyToken } = await import('../../src/utils/jwt.js');

      const payload = { userId: 'test-123', email: 'test@example.com' };
      const token = generateToken(payload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const verified = verifyToken(token);
      expect(verified.userId).toBe(payload.userId);
      expect(verified.email).toBe(payload.email);
    });

    it('should extract token from header', async () => {
      const { extractTokenFromHeader } = await import('../../src/utils/jwt.js');

      expect(extractTokenFromHeader('Bearer abc123')).toBe('abc123');
      expect(extractTokenFromHeader('abc123')).toBeNull();
      expect(extractTokenFromHeader(undefined)).toBeNull();
    });
  });
});
