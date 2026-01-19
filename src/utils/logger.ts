import pino from 'pino';
import { env } from '../config/env.js';

const isDevelopment = env.NODE_ENV === 'development';

export const logger = pino.default({
  level: env.LOG_LEVEL,
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
  base: {
    env: env.NODE_ENV,
  },
  redact: {
    paths: ['password', 'token', 'authorization', 'apiKey', 'secret'],
    censor: '[REDACTED]',
  },
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
});

// Child logger for specific contexts
export function createLogger(context: string): pino.Logger {
  return logger.child({ context });
}

// Request logger helper
export function logRequest(
  method: string,
  url: string,
  statusCode: number,
  durationMs: number,
  userId?: string
): void {
  logger.info({
    type: 'request',
    method,
    url,
    statusCode,
    durationMs,
    userId,
  }, `${method} ${url} ${statusCode} ${durationMs}ms`);
}

// Error logger helper
export function logError(
  error: Error,
  context?: Record<string, unknown>
): void {
  logger.error({
    err: {
      message: error.message,
      name: error.name,
      stack: error.stack,
    },
    ...context,
  }, error.message);
}

export type { Logger } from 'pino';
