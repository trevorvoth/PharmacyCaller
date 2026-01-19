import type { FastifyRequest, FastifyReply } from 'fastify';
import { userService } from '../services/userService.js';
import { logger } from '../utils/logger.js';

const DAILY_SEARCH_LIMIT = 10;

export async function checkSearchLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = request.user?.userId;

  if (!userId) {
    return reply.status(401).send({
      error: 'Authentication required',
    });
  }

  try {
    const currentCount = await userService.getDailySearchCount(userId);

    // Add limit headers
    void reply.header('X-Search-Limit', DAILY_SEARCH_LIMIT);
    void reply.header('X-Search-Remaining', Math.max(0, DAILY_SEARCH_LIMIT - currentCount));

    if (currentCount >= DAILY_SEARCH_LIMIT) {
      logger.warn({
        userId,
        currentCount,
        limit: DAILY_SEARCH_LIMIT,
      }, 'User search limit exceeded');

      return reply.status(429).send({
        error: 'Daily search limit exceeded',
        message: `You have reached your daily limit of ${DAILY_SEARCH_LIMIT} searches. Limit resets at midnight.`,
        currentCount,
        limit: DAILY_SEARCH_LIMIT,
      });
    }
  } catch (error) {
    logger.error({ err: error, userId }, 'Failed to check search limit');
    // Allow request through if check fails
  }
}

export async function incrementSearchCount(userId: string): Promise<void> {
  try {
    await userService.updateDailySearchCount(userId);
  } catch (error) {
    logger.error({ err: error, userId }, 'Failed to increment search count');
  }
}

export { DAILY_SEARCH_LIMIT };
