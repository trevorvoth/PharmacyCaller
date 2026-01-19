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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$on as any)('query', (e: any) => {
    logger.debug({
      query: e.query,
      params: e.params,
      duration: e.duration,
    }, 'Database query');
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma.$on as any)('error', (e: any) => {
  logger.error({ err: e }, 'Database error');
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma.$on as any)('warn', (e: any) => {
  logger.warn({ message: e.message }, 'Database warning');
});

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
