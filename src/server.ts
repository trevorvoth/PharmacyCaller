import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createServer } from 'http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { initSentry, sentryErrorHandler } from './utils/sentry.js';
import { prisma } from './db/client.js';
import { redis } from './services/redis.js';
import { registerAuthHook } from './middleware/auth.js';
import { defaultRateLimit, authRateLimit } from './middleware/rateLimit.js';
import { authRoutes } from './routes/auth.js';
import { pharmacyRoutes } from './routes/pharmacies.js';
import { twilioWebhookRoutes } from './routes/webhooks/twilio.js';
import { initWebSocketServer, closeWebSocketServer } from './websocket/server.js';

// Initialize Sentry first
initSentry();

const app = Fastify({
  logger: false, // We use pino directly
});

// Register plugins
await app.register(cors, {
  origin: env.NODE_ENV === 'production'
    ? ['https://pharmacycaller.com'] // Update with your domain
    : true,
  credentials: true,
});

// Register auth decorator
registerAuthHook(app);

// Health check endpoint (no rate limit)
app.get('/health', async (_request, _reply) => {
  const dbHealthy = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const redisHealthy = await redis.ping().then(() => true).catch(() => false);

  const status = dbHealthy && redisHealthy ? 'healthy' : 'unhealthy';

  return {
    status,
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
    },
  };
});

// Apply rate limiting (skip for webhooks which have their own auth)
app.addHook('onRequest', async (request, reply) => {
  // Skip rate limiting for Twilio webhooks (they have signature verification)
  if (request.url.startsWith('/webhooks/')) {
    return;
  }

  if (request.url.startsWith('/auth/')) {
    await authRateLimit(request, reply);
  } else if (!request.url.startsWith('/health')) {
    await defaultRateLimit(request, reply);
  }
});

// Register routes
await app.register(authRoutes);
await app.register(pharmacyRoutes);
await app.register(twilioWebhookRoutes);

// Global error handler
app.setErrorHandler((error, request, reply) => {
  sentryErrorHandler(error, request);

  logger.error({
    err: error,
    requestId: request.id,
    url: request.url,
    method: request.method,
  }, 'Request error');

  const statusCode = error.statusCode ?? 500;
  const message = statusCode === 500 ? 'Internal Server Error' : error.message;

  return reply.status(statusCode).send({
    error: message,
    statusCode,
  });
});

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  logger.info('Shutting down gracefully...');

  await closeWebSocketServer();
  await app.close();
  await prisma.$disconnect();
  await redis.quit();

  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

// Start server
const start = async (): Promise<void> => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('Database connected');

    // Test Redis connection
    await redis.ping();
    logger.info('Redis connected');

    // Get the underlying HTTP server for Socket.io
    const httpServer = createServer();

    // Initialize WebSocket server
    initWebSocketServer(httpServer);
    logger.info('WebSocket server initialized');

    // Start Fastify on the HTTP server
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, 'Server started');
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

void start();

export { app };
