import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../services/redis.js';
import { logger } from '../utils/logger.js';

const RATE_LIMIT_PREFIX = 'ratelimit:';
const DEFAULT_WINDOW_SECONDS = 60; // 1 minute
const DEFAULT_MAX_REQUESTS = 10; // 10 requests per minute

interface RateLimitConfig {
  windowSeconds?: number;
  maxRequests?: number;
  keyPrefix?: string;
}

function getClientIp(request: FastifyRequest): string {
  // Check for forwarded headers (when behind proxy/load balancer)
  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
    return ips?.trim() ?? request.ip;
  }

  const realIp = request.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] ?? request.ip : realIp;
  }

  return request.ip;
}

export function createRateLimiter(config: RateLimitConfig = {}) {
  const {
    windowSeconds = DEFAULT_WINDOW_SECONDS,
    maxRequests = DEFAULT_MAX_REQUESTS,
    keyPrefix = '',
  } = config;

  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const clientIp = getClientIp(request);
    const key = `${RATE_LIMIT_PREFIX}${keyPrefix}${clientIp}`;

    try {
      const current = await redis.incr(key);

      // Set expiry on first request
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      // Get TTL for headers
      const ttl = await redis.ttl(key);

      // Set rate limit headers
      void reply.header('X-RateLimit-Limit', maxRequests);
      void reply.header('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
      void reply.header('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + ttl);

      if (current > maxRequests) {
        logger.warn({
          clientIp,
          current,
          maxRequests,
        }, 'Rate limit exceeded');

        return reply.status(429).send({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again in ${ttl} seconds.`,
          retryAfter: ttl,
        });
      }
    } catch (error) {
      // If Redis fails, log but allow the request through
      logger.error({ err: error }, 'Rate limit check failed');
    }
  };
}

// Default rate limiter (10 requests per minute per IP)
export const defaultRateLimit = createRateLimiter();

// Stricter rate limiter for auth endpoints (5 requests per minute)
export const authRateLimit = createRateLimiter({
  maxRequests: 5,
  keyPrefix: 'auth:',
});

// Generous rate limiter for read-only endpoints (60 requests per minute)
export const readOnlyRateLimit = createRateLimiter({
  maxRequests: 60,
  keyPrefix: 'readonly:',
});
