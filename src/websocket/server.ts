import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { authenticateWebSocket } from './auth.js';
import type { JwtPayload } from '../utils/jwt.js';

const wsLogger = logger.child({ service: 'websocket-server' });

// Extend Socket to include user data
declare module 'socket.io' {
  interface Socket {
    user?: JwtPayload;
  }
}

/**
 * Notification event types sent to clients
 */
export enum NotificationEvent {
  PHARMACIST_READY = 'pharmacist_ready',
  VOICEMAIL_READY = 'voicemail_ready',
  CALL_STATUS_UPDATE = 'call_status_update',
  IVR_FAILED = 'ivr_failed',
  SEARCH_UPDATE = 'search_update',
  CONNECTION_STATUS = 'connection_status',
}

/**
 * Room naming conventions
 * - user:{userId} - User's personal room for all their notifications
 * - search:{searchId} - Room for a specific search session
 */
function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

function getSearchRoom(searchId: string): string {
  return `search:${searchId}`;
}

let io: SocketIOServer | null = null;

/**
 * Initialize the Socket.io WebSocket server
 */
export function initWebSocketServer(httpServer: HTTPServer): SocketIOServer {
  wsLogger.info('Initializing WebSocket server');

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.NODE_ENV === 'production'
        ? ['https://pharmacycaller.com']
        : '*',
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      await authenticateWebSocket(socket, next);
    } catch (error) {
      wsLogger.error({ err: error }, 'WebSocket authentication error');
      next(new Error('Authentication failed'));
    }
  });

  // Connection handler
  io.on('connection', (socket: Socket) => {
    handleConnection(socket);
  });

  wsLogger.info('WebSocket server initialized');

  return io;
}

/**
 * Handle new WebSocket connection
 */
function handleConnection(socket: Socket): void {
  const user = socket.user;

  if (!user) {
    wsLogger.warn({ socketId: socket.id }, 'Connection without user - disconnecting');
    socket.disconnect();
    return;
  }

  wsLogger.info({
    socketId: socket.id,
    userId: user.userId,
    email: user.email,
  }, 'Client connected');

  // Join user's personal room
  const userRoom = getUserRoom(user.userId);
  socket.join(userRoom);

  wsLogger.debug({
    socketId: socket.id,
    room: userRoom,
  }, 'Client joined user room');

  // Send connection confirmation
  socket.emit(NotificationEvent.CONNECTION_STATUS, {
    connected: true,
    userId: user.userId,
    timestamp: new Date().toISOString(),
  });

  // Handle search room subscription
  socket.on('subscribe:search', (searchId: string) => {
    if (!searchId || typeof searchId !== 'string') {
      wsLogger.warn({ socketId: socket.id }, 'Invalid search subscription');
      return;
    }

    const searchRoom = getSearchRoom(searchId);
    socket.join(searchRoom);

    wsLogger.debug({
      socketId: socket.id,
      searchId,
      room: searchRoom,
    }, 'Client subscribed to search');

    socket.emit('subscribed', { searchId });
  });

  // Handle search room unsubscription
  socket.on('unsubscribe:search', (searchId: string) => {
    if (!searchId || typeof searchId !== 'string') {
      return;
    }

    const searchRoom = getSearchRoom(searchId);
    socket.leave(searchRoom);

    wsLogger.debug({
      socketId: socket.id,
      searchId,
    }, 'Client unsubscribed from search');

    socket.emit('unsubscribed', { searchId });
  });

  // Handle ping for connection health
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    wsLogger.info({
      socketId: socket.id,
      userId: user.userId,
      reason,
    }, 'Client disconnected');
  });

  // Handle errors
  socket.on('error', (error) => {
    wsLogger.error({
      socketId: socket.id,
      userId: user.userId,
      err: error,
    }, 'Socket error');
  });
}

/**
 * Send notification to a specific user
 */
export function sendToUser(userId: string, event: NotificationEvent, data: unknown): void {
  if (!io) {
    wsLogger.warn('WebSocket server not initialized');
    return;
  }

  const room = getUserRoom(userId);
  io.to(room).emit(event, data);

  wsLogger.debug({
    userId,
    event,
  }, 'Sent notification to user');
}

/**
 * Send notification to all clients subscribed to a search
 */
export function sendToSearch(searchId: string, event: NotificationEvent, data: unknown): void {
  if (!io) {
    wsLogger.warn('WebSocket server not initialized');
    return;
  }

  const room = getSearchRoom(searchId);
  io.to(room).emit(event, data);

  wsLogger.debug({
    searchId,
    event,
  }, 'Sent notification to search subscribers');
}

/**
 * Get the Socket.io server instance
 */
export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Check if a user is currently connected
 */
export async function isUserConnected(userId: string): Promise<boolean> {
  if (!io) {
    return false;
  }

  const room = getUserRoom(userId);
  const sockets = await io.in(room).fetchSockets();
  return sockets.length > 0;
}

/**
 * Get connected client count for a search
 */
export async function getSearchSubscriberCount(searchId: string): Promise<number> {
  if (!io) {
    return 0;
  }

  const room = getSearchRoom(searchId);
  const sockets = await io.in(room).fetchSockets();
  return sockets.length;
}

/**
 * Broadcast a message to all connected clients
 */
export function broadcast(event: NotificationEvent, data: unknown): void {
  if (!io) {
    wsLogger.warn('WebSocket server not initialized');
    return;
  }

  io.emit(event, data);

  wsLogger.debug({ event }, 'Broadcast sent');
}

/**
 * Close the WebSocket server
 */
export async function closeWebSocketServer(): Promise<void> {
  if (io) {
    wsLogger.info('Closing WebSocket server');
    await io.close();
    io = null;
  }
}
