import * as Sentry from '@sentry/node';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import type { FastifyRequest } from 'fastify';

export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.warn('Sentry DSN not configured, error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    integrations: [
      Sentry.httpIntegration(),
    ],
    beforeSend(event) {
      // Filter out sensitive data
      if (event.request) {
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
        if (event.request.data && typeof event.request.data === 'object') {
          const data = event.request.data as Record<string, unknown>;
          if ('password' in data) {
            data['password'] = '[REDACTED]';
          }
        }
      }
      return event;
    },
  });

  logger.info('Sentry initialized');
}

export function captureException(
  error: Error,
  context?: Record<string, unknown>
): void {
  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(error);
  });
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>
): void {
  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureMessage(message, level);
  });
}

export function setUser(userId: string, email?: string): void {
  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.setUser({ id: userId, email });
}

export function clearUser(): void {
  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.setUser(null);
}

export function sentryErrorHandler(
  error: Error,
  request: FastifyRequest
): void {
  captureException(error, {
    requestId: request.id,
    url: request.url,
    method: request.method,
    headers: request.headers,
  });
}

// Test function to verify Sentry is working
export async function testSentryConnection(): Promise<boolean> {
  if (!env.SENTRY_DSN) {
    return false;
  }

  try {
    Sentry.captureMessage('Sentry test message - PharmacyCaller startup', 'info');
    await Sentry.flush(2000);
    return true;
  } catch {
    return false;
  }
}

export { Sentry };
