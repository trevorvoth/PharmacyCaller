import type { Socket } from 'socket.io';
import { verifyToken, type JwtPayload } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

// ExtendedError type for socket.io middleware
interface ExtendedError extends Error {
  data?: Record<string, unknown>;
}

const authLogger = logger.child({ service: 'websocket-auth' });

/**
 * Authenticate WebSocket connection using JWT token
 *
 * The client can provide the token in one of two ways:
 * 1. As a query parameter: ?token=xxx
 * 2. In the auth handshake: { auth: { token: 'xxx' } }
 */
export async function authenticateWebSocket(
  socket: Socket,
  next: (err?: ExtendedError) => void
): Promise<void> {
  // Try to get token from auth handshake first, then query params
  const token = socket.handshake.auth?.token as string | undefined
    ?? socket.handshake.query?.token as string | undefined;

  if (!token) {
    authLogger.warn({
      socketId: socket.id,
      ip: socket.handshake.address,
    }, 'WebSocket connection without token');

    const error = new Error('Authentication required') as ExtendedError;
    error.data = { code: 'AUTH_REQUIRED' };
    return next(error);
  }

  try {
    const payload = verifyToken(token);

    // Attach user to socket for later use
    socket.user = payload;

    authLogger.debug({
      socketId: socket.id,
      userId: payload.userId,
      email: payload.email,
    }, 'WebSocket authenticated');

    next();
  } catch (error) {
    authLogger.warn({
      socketId: socket.id,
      ip: socket.handshake.address,
      err: error,
    }, 'Invalid WebSocket token');

    const authError = new Error('Invalid or expired token') as ExtendedError;
    authError.data = { code: 'INVALID_TOKEN' };
    return next(authError);
  }
}

/**
 * Extract user ID from an authenticated socket
 */
export function getUserIdFromSocket(socket: Socket): string | null {
  return socket.user?.userId ?? null;
}

/**
 * Check if a socket is authenticated
 */
export function isSocketAuthenticated(socket: Socket): boolean {
  return !!socket.user;
}

/**
 * Get user payload from socket
 */
export function getSocketUser(socket: Socket): JwtPayload | null {
  return socket.user ?? null;
}

/**
 * Middleware to verify socket is authenticated for event handlers
 */
export function requireAuth(
  handler: (socket: Socket, ...args: unknown[]) => void | Promise<void>
): (socket: Socket, ...args: unknown[]) => void | Promise<void> {
  return (socket: Socket, ...args: unknown[]) => {
    if (!socket.user) {
      authLogger.warn({
        socketId: socket.id,
      }, 'Unauthenticated socket attempted protected operation');
      socket.emit('error', { code: 'AUTH_REQUIRED', message: 'Authentication required' });
      return;
    }

    return handler(socket, ...args);
  };
}
