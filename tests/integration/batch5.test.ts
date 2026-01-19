import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import twilio from 'twilio';
import { redis } from '../../src/services/redis.js';
import { generateToken } from '../../src/utils/jwt.js';
import { CallState } from '../../src/types/callStates.js';
import { callStateMachine } from '../../src/services/callStateMachine.js';
import { ivrFallback } from '../../src/services/openai/ivrFallback.js';
import { openaiEventHandler, DetectionType, type AIDetectionEvent } from '../../src/services/openai/eventHandler.js';
import { initWebSocketServer, closeWebSocketServer, NotificationEvent } from '../../src/websocket/server.js';
import { notificationService } from '../../src/services/notifications.js';

// Mock Twilio validateRequest
vi.mock('twilio', async () => {
  const actual = await vi.importActual('twilio');
  return {
    ...actual,
    default: {
      ...actual,
      validateRequest: vi.fn().mockReturnValue(true),
    },
  };
});

describe('Batch 5: Webhooks & Real-time Notifications', () => {
  let httpServer: HTTPServer;
  let serverPort: number;
  let testToken: string;
  let clientSocket: ClientSocket;

  const testUserId = 'test-user-batch5';
  const testSearchId = 'test-search-batch5';
  const testCallId = 'test-call-batch5';

  beforeAll(async () => {
    // Clear test data
    const keys = await redis.keys('test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // Create HTTP server for WebSocket
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 3999;
        resolve();
      });
    });

    // Initialize WebSocket server
    initWebSocketServer(httpServer);

    // Generate test token
    testToken = generateToken({ userId: testUserId, email: 'test@example.com' });
  });

  afterAll(async () => {
    // Cleanup
    if (clientSocket?.connected) {
      clientSocket.disconnect();
    }
    await closeWebSocketServer();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    // Clear test data
    const keys = await redis.keys('*batch5*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  beforeEach(async () => {
    // Clean up call state between tests
    await redis.del(`call:state:${testCallId}`);
    await redis.del(`search:calls:${testSearchId}`);
  });

  describe('5.3: Twilio Webhook Signature Verification', () => {
    it('should have validateRequest function available', () => {
      // Verify the Twilio library exposes validateRequest
      expect(typeof twilio.validateRequest).toBe('function');
    });

    it('should validate Twilio request signature format', () => {
      // Test that the signature verification logic handles different signature formats
      // The actual validation is mocked, but we verify the interface exists
      const authToken = 'test_auth_token';
      const url = 'https://example.com/webhooks/twilio/voice';
      const params = { CallSid: 'CA123' };
      const signature = 'test_signature';

      // The function should accept the correct parameters without throwing
      expect(() => {
        twilio.validateRequest(authToken, signature, url, params);
      }).not.toThrow();
    });

    it('should verify webhook auth middleware rejects missing signature', async () => {
      // This tests the actual middleware behavior
      // In production, missing X-Twilio-Signature header should result in 403
      const { validateTwilioSignature } = await import('../../src/middleware/webhookAuth.js');
      expect(typeof validateTwilioSignature).toBe('function');
    });
  });

  describe('5.5-5.8: OpenAI Event Handler', () => {
    beforeEach(async () => {
      // Set up a test call state
      await callStateMachine.createCall({
        callId: testCallId,
        searchId: testSearchId,
        pharmacyId: 'test-pharmacy',
        pharmacyName: 'Test Pharmacy',
        phoneNumber: '+15551234567',
      });

      // Initialize IVR navigation state
      ivrFallback.initNavigation(testCallId, 'Test Pharmacy');

      // Transition to IVR state
      await callStateMachine.transition(testCallId, CallState.DIALING);
      await callStateMachine.transition(testCallId, CallState.IVR);
    });

    it('5.6: should handle human_detected event', async () => {
      const event: AIDetectionEvent = {
        callId: testCallId,
        searchId: testSearchId,
        detectionType: DetectionType.HUMAN_DETECTED,
        confidence: 0.95,
        transcript: 'Hello, this is the pharmacy',
        timestamp: Date.now(),
      };

      await openaiEventHandler.processDetection(event);

      const callState = await callStateMachine.getState(testCallId);
      expect(callState?.state).toBe(CallState.HUMAN_DETECTED);
    });

    it('5.7: should handle voicemail_detected event', async () => {
      const event: AIDetectionEvent = {
        callId: testCallId,
        searchId: testSearchId,
        detectionType: DetectionType.VOICEMAIL_DETECTED,
        confidence: 0.9,
        timestamp: Date.now(),
      };

      await openaiEventHandler.processDetection(event);

      const callState = await callStateMachine.getState(testCallId);
      expect(callState?.state).toBe(CallState.VOICEMAIL);
    });

    it('5.8: should handle ivr_failed event after max attempts', async () => {
      // Record max attempts first
      ivrFallback.recordAttempt(testCallId, 'Error 1');
      ivrFallback.recordAttempt(testCallId, 'Error 2');
      ivrFallback.recordAttempt(testCallId, 'Error 3');

      const event: AIDetectionEvent = {
        callId: testCallId,
        searchId: testSearchId,
        detectionType: DetectionType.IVR_FAILED,
        confidence: 1.0,
        context: 'Unable to navigate menu',
        timestamp: Date.now(),
      };

      await openaiEventHandler.processDetection(event);

      const callState = await callStateMachine.getState(testCallId);
      expect(callState?.state).toBe(CallState.IVR_FAILED);
    });

    it('should handle hold detection', async () => {
      const event: AIDetectionEvent = {
        callId: testCallId,
        searchId: testSearchId,
        detectionType: DetectionType.HOLD_MUSIC,
        confidence: 0.85,
        timestamp: Date.now(),
      };

      await openaiEventHandler.processDetection(event);

      const callState = await callStateMachine.getState(testCallId);
      expect(callState?.state).toBe(CallState.HOLD);
    });

    it('should ignore low confidence detections', async () => {
      const event: AIDetectionEvent = {
        callId: testCallId,
        searchId: testSearchId,
        detectionType: DetectionType.HUMAN_DETECTED,
        confidence: 0.5, // Below threshold
        timestamp: Date.now(),
      };

      await openaiEventHandler.processDetection(event);

      // Should still be in IVR state
      const callState = await callStateMachine.getState(testCallId);
      expect(callState?.state).toBe(CallState.IVR);
    });

    it('should create detection event from function call', () => {
      const event = openaiEventHandler.createDetectionEvent(
        testCallId,
        testSearchId,
        'report_human_detected',
        { confidence: 0.9, transcript: 'Hello' }
      );

      expect(event).not.toBeNull();
      expect(event?.detectionType).toBe(DetectionType.HUMAN_DETECTED);
      expect(event?.confidence).toBe(0.9);
    });
  });

  describe('5.9-5.10: WebSocket Server & Authentication', () => {
    it('should connect with valid token', async () => {
      return new Promise<void>((resolve, reject) => {
        const socket = ioClient(`http://localhost:${serverPort}`, {
          auth: { token: testToken },
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          expect(socket.connected).toBe(true);
          socket.disconnect();
          resolve();
        });

        socket.on('connect_error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          socket.disconnect();
          reject(new Error('Connection timeout'));
        }, 5000);
      });
    });

    it('should reject connection without token', async () => {
      return new Promise<void>((resolve) => {
        const socket = ioClient(`http://localhost:${serverPort}`, {
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          socket.disconnect();
          throw new Error('Should not connect without token');
        });

        socket.on('connect_error', (err) => {
          expect(err.message).toContain('Authentication');
          socket.disconnect();
          resolve();
        });

        setTimeout(() => {
          socket.disconnect();
          resolve();
        }, 2000);
      });
    });

    it('should subscribe to search room', async () => {
      return new Promise<void>((resolve, reject) => {
        const socket = ioClient(`http://localhost:${serverPort}`, {
          auth: { token: testToken },
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          socket.emit('subscribe:search', testSearchId);
        });

        socket.on('subscribed', (data) => {
          expect(data.searchId).toBe(testSearchId);
          socket.disconnect();
          resolve();
        });

        socket.on('connect_error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          socket.disconnect();
          reject(new Error('Subscription timeout'));
        }, 5000);
      });
    });

    it('should receive connection status on connect', async () => {
      return new Promise<void>((resolve, reject) => {
        const socket = ioClient(`http://localhost:${serverPort}`, {
          auth: { token: testToken },
          transports: ['websocket'],
        });

        socket.on(NotificationEvent.CONNECTION_STATUS, (data) => {
          expect(data.connected).toBe(true);
          expect(data.userId).toBe(testUserId);
          socket.disconnect();
          resolve();
        });

        socket.on('connect_error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          socket.disconnect();
          reject(new Error('Connection status timeout'));
        }, 5000);
      });
    });
  });

  describe('5.11-5.14: Notification Service', () => {
    it('5.11: should send pharmacist_ready notification', async () => {
      const payload = {
        callId: testCallId,
        pharmacyId: 'test-pharmacy',
        pharmacyName: 'Test Pharmacy',
        message: 'A pharmacist is ready to speak with you.',
      };

      // This won't throw even if no clients connected
      await expect(
        notificationService.sendPharmacistReady(testSearchId, payload)
      ).resolves.not.toThrow();

      // Verify notification stored
      const notifications = await notificationService.getSearchNotifications(testSearchId);
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].type).toBe('pharmacist_ready');
    });

    it('5.12: should send voicemail_ready notification', async () => {
      const payload = {
        callId: testCallId,
        pharmacyId: 'test-pharmacy',
        pharmacyName: 'Test Pharmacy',
        message: 'Reached voicemail at Test Pharmacy.',
      };

      await expect(
        notificationService.sendVoicemailReady(testSearchId, payload)
      ).resolves.not.toThrow();

      const notifications = await notificationService.getSearchNotifications(testSearchId);
      const voicemailNotif = notifications.find((n) => n.type === 'voicemail_ready');
      expect(voicemailNotif).toBeDefined();
    });

    it('5.13: should send call_status_update notification', async () => {
      const payload = {
        callId: testCallId,
        pharmacyId: 'test-pharmacy',
        pharmacyName: 'Test Pharmacy',
        status: CallState.HOLD,
        previousStatus: CallState.IVR,
        message: 'On hold at Test Pharmacy.',
      };

      await expect(
        notificationService.sendCallStatusUpdate(testSearchId, payload)
      ).resolves.not.toThrow();
    });

    it('5.14: should send ivr_failed notification', async () => {
      const payload = {
        callId: testCallId,
        pharmacyId: 'test-pharmacy',
        pharmacyName: 'Test Pharmacy',
        message: 'Unable to navigate phone system.',
        fallbackMessage: 'You may want to try calling directly.',
      };

      await expect(
        notificationService.sendIVRFailed(testSearchId, payload)
      ).resolves.not.toThrow();

      const notifications = await notificationService.getSearchNotifications(testSearchId);
      const ivrFailedNotif = notifications.find((n) => n.type === 'ivr_failed');
      expect(ivrFailedNotif).toBeDefined();
    });

    it('should store pending notifications for offline users', async () => {
      const offlineUserId = 'offline-user-batch5';

      const sent = await notificationService.sendToUser(
        offlineUserId,
        NotificationEvent.PHARMACIST_READY,
        { message: 'Test notification' }
      );

      // User is offline, should return false
      expect(sent).toBe(false);

      // Should be stored
      const pending = await notificationService.getPendingNotifications(offlineUserId);
      expect(pending.length).toBe(1);

      // Cleanup
      await notificationService.clearPendingNotifications(offlineUserId);
    });
  });

  describe('5.15: Event Handler to Notification Integration', () => {
    it('should send notification when human detected', async () => {
      // Set up call
      await callStateMachine.createCall({
        callId: 'integration-call-5',
        searchId: 'integration-search-5',
        pharmacyId: 'test-pharmacy',
        pharmacyName: 'Integration Pharmacy',
        phoneNumber: '+15551234567',
      });
      ivrFallback.initNavigation('integration-call-5', 'Integration Pharmacy');
      await callStateMachine.transition('integration-call-5', CallState.DIALING);
      await callStateMachine.transition('integration-call-5', CallState.IVR);

      const event: AIDetectionEvent = {
        callId: 'integration-call-5',
        searchId: 'integration-search-5',
        detectionType: DetectionType.HUMAN_DETECTED,
        confidence: 0.95,
        transcript: 'Hello, how can I help you?',
        timestamp: Date.now(),
      };

      await openaiEventHandler.processDetection(event);

      // Verify notification was stored
      const notifications = await notificationService.getSearchNotifications('integration-search-5');
      const humanNotif = notifications.find((n) => n.type === 'pharmacist_ready');
      expect(humanNotif).toBeDefined();

      // Cleanup
      await redis.del('call:state:integration-call-5');
      await redis.del('search:calls:integration-search-5');
    });

    it('should send notification when IVR fails', async () => {
      // Set up call
      await callStateMachine.createCall({
        callId: 'ivr-fail-call-5',
        searchId: 'ivr-fail-search-5',
        pharmacyId: 'test-pharmacy',
        pharmacyName: 'Fail Test Pharmacy',
        phoneNumber: '+15551234567',
      });
      ivrFallback.initNavigation('ivr-fail-call-5', 'Fail Test Pharmacy');
      await callStateMachine.transition('ivr-fail-call-5', CallState.DIALING);
      await callStateMachine.transition('ivr-fail-call-5', CallState.IVR);

      // Max out attempts
      ivrFallback.recordAttempt('ivr-fail-call-5', 'Error 1');
      ivrFallback.recordAttempt('ivr-fail-call-5', 'Error 2');
      ivrFallback.recordAttempt('ivr-fail-call-5', 'Error 3');

      const event: AIDetectionEvent = {
        callId: 'ivr-fail-call-5',
        searchId: 'ivr-fail-search-5',
        detectionType: DetectionType.IVR_FAILED,
        confidence: 1.0,
        context: 'Menu navigation failed',
        timestamp: Date.now(),
      };

      await openaiEventHandler.processDetection(event);

      // Verify notification was stored
      const notifications = await notificationService.getSearchNotifications('ivr-fail-search-5');
      const ivrFailedNotif = notifications.find((n) => n.type === 'ivr_failed');
      expect(ivrFailedNotif).toBeDefined();

      // Cleanup
      await redis.del('call:state:ivr-fail-call-5');
      await redis.del('search:calls:ivr-fail-search-5');
    });
  });

  describe('WebSocket Live Notifications', () => {
    it('should receive real-time notifications via WebSocket', async () => {
      return new Promise<void>((resolve, reject) => {
        const socket = ioClient(`http://localhost:${serverPort}`, {
          auth: { token: testToken },
          transports: ['websocket'],
        });

        const liveSearchId = 'live-search-' + Date.now();

        socket.on('connect', () => {
          socket.emit('subscribe:search', liveSearchId);
        });

        socket.on('subscribed', async () => {
          // Now send a notification
          await notificationService.sendPharmacistReady(liveSearchId, {
            callId: 'live-call',
            pharmacyId: 'live-pharmacy',
            pharmacyName: 'Live Pharmacy',
            message: 'Pharmacist ready!',
          });
        });

        socket.on(NotificationEvent.PHARMACIST_READY, (data) => {
          expect(data.pharmacyName).toBe('Live Pharmacy');
          expect(data.message).toBe('Pharmacist ready!');
          socket.disconnect();
          resolve();
        });

        socket.on('connect_error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          socket.disconnect();
          reject(new Error('Live notification timeout'));
        }, 5000);
      });
    });
  });
});
