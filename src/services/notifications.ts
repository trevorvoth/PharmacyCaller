import { logger } from '../utils/logger.js';
import {
  sendToSearch,
  sendToUser,
  isUserConnected,
  NotificationEvent,
} from '../websocket/server.js';
import { redis } from './redis.js';
import { CallState } from '../types/callStates.js';

const notificationLogger = logger.child({ service: 'notifications' });

/**
 * Notification payloads
 */
export interface PharmacistReadyPayload {
  searchId: string;
  callId: string;
  pharmacyId: string;
  pharmacyName: string;
  message: string;
  timestamp?: string;
}

export interface VoicemailReadyPayload {
  searchId: string;
  callId: string;
  pharmacyId: string;
  pharmacyName: string;
  message: string;
  timestamp?: string;
}

export interface CallStatusUpdatePayload {
  callId: string;
  pharmacyId: string;
  pharmacyName: string;
  status: CallState;
  previousStatus: CallState;
  message?: string;
  timestamp?: string;
}

export interface IVRFailedPayload {
  callId: string;
  pharmacyId: string;
  pharmacyName: string;
  message: string;
  fallbackMessage: string;
  timestamp?: string;
}

export interface SearchUpdatePayload {
  searchId: string;
  status: 'active' | 'completed' | 'cancelled';
  activeCalls: number;
  connectedCalls: number;
  failedCalls: number;
  timestamp?: string;
}

// Redis key for storing pending notifications (for offline users)
const PENDING_NOTIFICATIONS_PREFIX = 'pending:notifications:';
const PENDING_NOTIFICATION_TTL = 60 * 60; // 1 hour

/**
 * Notification Service
 *
 * Handles sending real-time notifications to users via WebSocket
 * Also stores pending notifications for offline users
 */
class NotificationService {
  /**
   * Task 5.11: Send "pharmacist_ready" notification
   *
   * Notifies the patient that a pharmacist is ready to speak with them
   */
  async sendPharmacistReady(searchId: string, payload: PharmacistReadyPayload): Promise<void> {
    const notification = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    notificationLogger.info({
      searchId,
      callId: payload.callId,
      pharmacyName: payload.pharmacyName,
    }, 'Sending pharmacist_ready notification');

    // Send to all clients subscribed to this search
    sendToSearch(searchId, NotificationEvent.PHARMACIST_READY, notification);

    // Store for potential retrieval
    await this.storeNotification(searchId, 'pharmacist_ready', notification);
  }

  /**
   * Task 5.12: Send "voicemail_ready" notification
   *
   * Notifies the patient that they've reached voicemail at a pharmacy
   */
  async sendVoicemailReady(searchId: string, payload: VoicemailReadyPayload): Promise<void> {
    const notification = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    notificationLogger.info({
      searchId,
      callId: payload.callId,
      pharmacyName: payload.pharmacyName,
    }, 'Sending voicemail_ready notification');

    sendToSearch(searchId, NotificationEvent.VOICEMAIL_READY, notification);

    await this.storeNotification(searchId, 'voicemail_ready', notification);
  }

  /**
   * Task 5.13: Send "call_status_update" notification
   *
   * Notifies the patient of call status changes (dialing, IVR, hold, etc.)
   */
  async sendCallStatusUpdate(searchId: string, payload: CallStatusUpdatePayload): Promise<void> {
    const notification = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    notificationLogger.debug({
      searchId,
      callId: payload.callId,
      status: payload.status,
      previousStatus: payload.previousStatus,
    }, 'Sending call_status_update notification');

    sendToSearch(searchId, NotificationEvent.CALL_STATUS_UPDATE, notification);

    // Don't store status updates - they're transient
  }

  /**
   * Task 5.14: Send "ivr_failed" notification
   *
   * Notifies the patient that IVR navigation failed for a pharmacy
   */
  async sendIVRFailed(searchId: string, payload: IVRFailedPayload): Promise<void> {
    const notification = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    notificationLogger.info({
      searchId,
      callId: payload.callId,
      pharmacyName: payload.pharmacyName,
    }, 'Sending ivr_failed notification');

    sendToSearch(searchId, NotificationEvent.IVR_FAILED, notification);

    await this.storeNotification(searchId, 'ivr_failed', notification);
  }

  /**
   * Send search status update
   */
  async sendSearchUpdate(searchId: string, payload: SearchUpdatePayload): Promise<void> {
    const notification = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    notificationLogger.debug({
      searchId,
      status: payload.status,
      activeCalls: payload.activeCalls,
    }, 'Sending search_update notification');

    sendToSearch(searchId, NotificationEvent.SEARCH_UPDATE, notification);
  }

  /**
   * Send notification directly to a user (by userId)
   */
  async sendToUser(
    userId: string,
    event: NotificationEvent,
    payload: unknown
  ): Promise<boolean> {
    const connected = await isUserConnected(userId);

    if (connected) {
      sendToUser(userId, event, payload);
      notificationLogger.debug({
        userId,
        event,
      }, 'Notification sent to user');
      return true;
    }

    // Store for later if user is offline
    await this.storePendingNotification(userId, event, payload);
    notificationLogger.debug({
      userId,
      event,
    }, 'User offline - notification stored');
    return false;
  }

  /**
   * Store a notification for a search session
   */
  private async storeNotification(
    searchId: string,
    type: string,
    notification: unknown
  ): Promise<void> {
    const key = `${PENDING_NOTIFICATIONS_PREFIX}search:${searchId}`;
    const entry = JSON.stringify({
      type,
      notification,
      timestamp: Date.now(),
    });

    await redis.lpush(key, entry);
    await redis.ltrim(key, 0, 99); // Keep last 100 notifications
    await redis.expire(key, PENDING_NOTIFICATION_TTL);
  }

  /**
   * Store a pending notification for an offline user
   */
  private async storePendingNotification(
    userId: string,
    event: NotificationEvent,
    payload: unknown
  ): Promise<void> {
    const key = `${PENDING_NOTIFICATIONS_PREFIX}user:${userId}`;
    const entry = JSON.stringify({
      event,
      payload,
      timestamp: Date.now(),
    });

    await redis.lpush(key, entry);
    await redis.ltrim(key, 0, 49); // Keep last 50 pending notifications
    await redis.expire(key, PENDING_NOTIFICATION_TTL);
  }

  /**
   * Get pending notifications for a user
   */
  async getPendingNotifications(userId: string): Promise<Array<{
    event: NotificationEvent;
    payload: unknown;
    timestamp: number;
  }>> {
    const key = `${PENDING_NOTIFICATIONS_PREFIX}user:${userId}`;
    const entries = await redis.lrange(key, 0, -1);

    return entries.map((entry: string) => JSON.parse(entry) as { event: NotificationEvent; payload: unknown; timestamp: number });
  }

  /**
   * Clear pending notifications for a user
   */
  async clearPendingNotifications(userId: string): Promise<void> {
    const key = `${PENDING_NOTIFICATIONS_PREFIX}user:${userId}`;
    await redis.del(key);
  }

  /**
   * Get recent notifications for a search session
   */
  async getSearchNotifications(searchId: string): Promise<Array<{
    type: string;
    notification: unknown;
    timestamp: number;
  }>> {
    const key = `${PENDING_NOTIFICATIONS_PREFIX}search:${searchId}`;
    const entries = await redis.lrange(key, 0, -1);

    return entries.map((entry: string) => JSON.parse(entry) as { type: string; notification: unknown; timestamp: number });
  }

  /**
   * Get count of unread notifications for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const key = `${PENDING_NOTIFICATIONS_PREFIX}user:${userId}`;
    const count = await redis.llen(key);
    return count;
  }
}

export const notificationService = new NotificationService();
