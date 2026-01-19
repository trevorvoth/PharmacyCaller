import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: env.NODE_ENV === 'development'
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ]
    : [{ emit: 'event', level: 'error' }],
});

if (env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug({
      query: e.query,
      params: e.params,
      duration: e.duration,
    }, 'Database query');
  });
}

prisma.$on('error', (e) => {
  logger.error({ err: e }, 'Database error');
});

prisma.$on('warn', (e) => {
  logger.warn({ message: e.message }, 'Database warning');
});

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
