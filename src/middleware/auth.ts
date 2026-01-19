import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, extractTokenFromHeader, type JwtPayload } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractTokenFromHeader(request.headers.authorization);

  if (!token) {
    return reply.status(401).send({
      error: 'Authentication required',
      message: 'Please provide a valid Bearer token in the Authorization header',
    });
  }

  try {
    const payload = verifyToken(token);
    request.user = payload;
  } catch (error) {
    logger.debug({ error }, 'Token verification failed');

    return reply.status(401).send({
      error: 'Invalid or expired token',
      message: 'Please login again to get a new token',
    });
  }
}

export function registerAuthHook(app: {
  decorate: (name: string, value: unknown) => void;
}): void {
  app.decorate('authenticate', authenticate);
}
