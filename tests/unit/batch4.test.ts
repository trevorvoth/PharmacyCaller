import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import {
  CallState,
  VALID_TRANSITIONS,
  ACTIVE_STATES,
  HUMAN_READY_STATES,
  TERMINAL_STATES,
  FAILED_STATES,
} from '../../src/types/callStates.js';
import { callStateMachine } from '../../src/services/callStateMachine.js';
import { callOrchestrator } from '../../src/services/callOrchestrator.js';
import { callQueue } from '../../src/services/callQueue.js';
import { patientTimeout } from '../../src/services/patientTimeout.js';
import { redis } from '../../src/services/redis.js';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

// Mock Twilio client
vi.mock('../../src/services/twilio/client.js', () => ({
  twilioClient: {
    calls: vi.fn().mockImplementation(() => ({
      update: vi.fn().mockResolvedValue({}),
      fetch: vi.fn().mockResolvedValue({ status: 'in-progress' }),
      create: vi.fn().mockResolvedValue({
        sid: 'CA_test_' + Date.now(),
        status: 'queued',
        to: '+15551234567',
        from: '+15559876543',
      }),
    })),
    conferences: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock Twilio calls initiation
vi.mock('../../src/services/twilio/calls.js', async () => {
  const actual = await vi.importActual('../../src/services/twilio/calls.js');
  return {
    ...actual,
    initiateCall: vi.fn().mockResolvedValue({
      callSid: 'CA_mock_' + Date.now(),
      status: 'queued',
      to: '+15551234567',
      from: '+15559876543',
    }),
  };
});

describe('Batch 4: Call State Machine & Orchestration', () => {
  beforeAll(async () => {
    // Clear test data
    const keys = await redis.keys('test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    // Cleanup
    const patterns = ['call:*', 'search:*', 'queue:*', 'timeout:*', 'connected:*'];
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    await redis.quit();
  });

  describe('Call States Definition', () => {
    it('should have all required call states defined', () => {
      expect(CallState.CREATED).toBe('CREATED');
      expect(CallState.DIALING).toBe('DIALING');
      expect(CallState.IVR).toBe('IVR');
      expect(CallState.IVR_FAILED).toBe('IVR_FAILED');
      expect(CallState.HOLD).toBe('HOLD');
      expect(CallState.HUMAN_DETECTED).toBe('HUMAN_DETECTED');
      expect(CallState.VOICEMAIL).toBe('VOICEMAIL');
      expect(CallState.FAILED).toBe('FAILED');
      expect(CallState.BRIDGING).toBe('BRIDGING');
      expect(CallState.CONNECTED).toBe('CONNECTED');
      expect(CallState.ENDING).toBe('ENDING');
      expect(CallState.ENDED).toBe('ENDED');
    });

    it('should have valid transitions defined for each state', () => {
      expect(VALID_TRANSITIONS[CallState.CREATED]).toContain(CallState.DIALING);
      expect(VALID_TRANSITIONS[CallState.DIALING]).toContain(CallState.IVR);
      expect(VALID_TRANSITIONS[CallState.IVR]).toContain(CallState.HOLD);
      expect(VALID_TRANSITIONS[CallState.IVR]).toContain(CallState.IVR_FAILED);
      expect(VALID_TRANSITIONS[CallState.HOLD]).toContain(CallState.HUMAN_DETECTED);
      expect(VALID_TRANSITIONS[CallState.HUMAN_DETECTED]).toContain(CallState.BRIDGING);
      expect(VALID_TRANSITIONS[CallState.BRIDGING]).toContain(CallState.CONNECTED);
      expect(VALID_TRANSITIONS[CallState.CONNECTED]).toContain(CallState.ENDING);
      expect(VALID_TRANSITIONS[CallState.ENDING]).toContain(CallState.ENDED);
    });

    it('should mark correct states as active', () => {
      expect(ACTIVE_STATES).toContain(CallState.CREATED);
      expect(ACTIVE_STATES).toContain(CallState.DIALING);
      expect(ACTIVE_STATES).toContain(CallState.IVR);
      expect(ACTIVE_STATES).toContain(CallState.HOLD);
      expect(ACTIVE_STATES).not.toContain(CallState.ENDED);
    });

    it('should mark correct states as human ready', () => {
      expect(HUMAN_READY_STATES).toContain(CallState.HUMAN_DETECTED);
      expect(HUMAN_READY_STATES).toContain(CallState.BRIDGING);
      expect(HUMAN_READY_STATES).toContain(CallState.CONNECTED);
      expect(HUMAN_READY_STATES).not.toContain(CallState.HOLD);
    });

    it('should have ENDED as terminal state', () => {
      expect(TERMINAL_STATES).toContain(CallState.ENDED);
      expect(VALID_TRANSITIONS[CallState.ENDED]).toEqual([]);
    });

    it('should mark failed states correctly', () => {
      expect(FAILED_STATES).toContain(CallState.IVR_FAILED);
      expect(FAILED_STATES).toContain(CallState.VOICEMAIL);
      expect(FAILED_STATES).toContain(CallState.FAILED);
    });
  });

  describe('Call State Machine', () => {
    const testSearchId = 'test-search-' + Date.now();
    const testCallId = 'test-call-' + Date.now();

    it('should be an EventEmitter', () => {
      expect(callStateMachine).toBeInstanceOf(EventEmitter);
    });

    it('should create a call with CREATED state', async () => {
      const callData = await callStateMachine.createCall({
        callId: testCallId,
        searchId: testSearchId,
        pharmacyId: 'pharmacy-1',
        pharmacyName: 'Test Pharmacy',
        phoneNumber: '+15551234567',
      });

      expect(callData.callId).toBe(testCallId);
      expect(callData.state).toBe(CallState.CREATED);
      expect(callData.previousState).toBeNull();
    });

    it('should get call state', async () => {
      const state = await callStateMachine.getState(testCallId);

      expect(state).not.toBeNull();
      expect(state?.callId).toBe(testCallId);
    });

    it('should validate transitions correctly', () => {
      expect(callStateMachine.isValidTransition(CallState.CREATED, CallState.DIALING)).toBe(true);
      expect(callStateMachine.isValidTransition(CallState.CREATED, CallState.CONNECTED)).toBe(false);
      expect(callStateMachine.isValidTransition(CallState.ENDED, CallState.CREATED)).toBe(false);
    });

    it('should transition to valid state', async () => {
      const result = await callStateMachine.transition(testCallId, CallState.DIALING, {
        reason: 'Test transition',
      });

      expect(result).not.toBeNull();
      expect(result?.state).toBe(CallState.DIALING);
      expect(result?.previousState).toBe(CallState.CREATED);
    });

    it('should reject invalid transition', async () => {
      // Try to skip directly to CONNECTED from DIALING
      const result = await callStateMachine.transition(testCallId, CallState.CONNECTED);

      expect(result).toBeNull();

      // State should remain unchanged
      const state = await callStateMachine.getState(testCallId);
      expect(state?.state).toBe(CallState.DIALING);
    });

    it('should track transition history', async () => {
      const history = await callStateMachine.getTransitionHistory(testCallId);

      expect(history.length).toBeGreaterThan(0);
      expect(history.some((h) => h.toState === CallState.DIALING)).toBe(true);
    });

    it('should emit stateChanged event on transition', async () => {
      const newCallId = 'event-test-' + Date.now();

      await callStateMachine.createCall({
        callId: newCallId,
        searchId: testSearchId,
        pharmacyId: 'pharmacy-2',
        pharmacyName: 'Event Test Pharmacy',
        phoneNumber: '+15559876543',
      });

      const stateChangedPromise = new Promise<void>((resolve) => {
        callStateMachine.once('stateChanged', (event) => {
          expect(event.callId).toBe(newCallId);
          expect(event.toState).toBe(CallState.DIALING);
          resolve();
        });
      });

      await callStateMachine.transition(newCallId, CallState.DIALING);
      await stateChangedPromise;
    });

    it('should emit humanDetected event when reaching HUMAN_DETECTED', async () => {
      const humanCallId = 'human-test-' + Date.now();

      await callStateMachine.createCall({
        callId: humanCallId,
        searchId: testSearchId,
        pharmacyId: 'pharmacy-3',
        pharmacyName: 'Human Test Pharmacy',
        phoneNumber: '+15551111111',
      });

      await callStateMachine.transition(humanCallId, CallState.DIALING);
      await callStateMachine.transition(humanCallId, CallState.IVR);
      await callStateMachine.transition(humanCallId, CallState.HOLD);

      const humanDetectedPromise = new Promise<void>((resolve) => {
        callStateMachine.once('humanDetected', (callId, data) => {
          expect(callId).toBe(humanCallId);
          expect(data.state).toBe(CallState.HUMAN_DETECTED);
          resolve();
        });
      });

      await callStateMachine.transition(humanCallId, CallState.HUMAN_DETECTED);
      await humanDetectedPromise;
    });

    it('should get all calls for a search', async () => {
      const calls = await callStateMachine.getSearchCalls(testSearchId);
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should get active calls for a search', async () => {
      const activeCalls = await callStateMachine.getActiveSearchCalls(testSearchId);
      expect(activeCalls.every((c) => ACTIVE_STATES.includes(c.state))).toBe(true);
    });
  });

  describe('Call Orchestrator', () => {
    const testSearchId = 'orch-search-' + Date.now();

    it('should create search state', async () => {
      const pharmacies = [
        { id: 'p1', name: 'Pharmacy 1', phoneNumber: '+15551111111' },
        { id: 'p2', name: 'Pharmacy 2', phoneNumber: '+15552222222' },
        { id: 'p3', name: 'Pharmacy 3', phoneNumber: '+15553333333' },
      ];

      const searchState = await callOrchestrator.startSearch({
        userId: 'user-1',
        searchId: testSearchId,
        medicationQuery: 'Ozempic',
        pharmacies,
      });

      expect(searchState.searchId).toBe(testSearchId);
      expect(searchState.status).toBe('active');
      expect(searchState.callIds.length).toBeLessThanOrEqual(3);
    });

    it('should get search state', async () => {
      const state = await callOrchestrator.getSearchState(testSearchId);

      expect(state).not.toBeNull();
      expect(state?.searchId).toBe(testSearchId);
    });

    it('should get call progress', async () => {
      const progress = await callOrchestrator.getCallProgress(testSearchId);

      expect(Array.isArray(progress)).toBe(true);
      expect(progress.every((p) => p.callId && p.pharmacyName && p.state)).toBe(true);
    });

    it('should mark search as found', async () => {
      const result = await callOrchestrator.markFound(testSearchId, 'Pharmacy 1');

      expect(result?.status).toBe('completed');
      expect(result?.result).toBe('found');
      expect(result?.foundAt).toBe('Pharmacy 1');
    });

    it('should check for humans ready', async () => {
      const hasHumans = await callOrchestrator.hasHumansReady(testSearchId);
      expect(typeof hasHumans).toBe('boolean');
    });
  });

  describe('Call Queue', () => {
    const testSearchId = 'queue-search-' + Date.now();
    const testCallId = 'queue-call-' + Date.now();

    it('should enqueue a call', async () => {
      await callQueue.enqueue({
        callId: testCallId,
        searchId: testSearchId,
        pharmacyId: 'p1',
        pharmacyName: 'Queue Test Pharmacy',
        phoneNumber: '+15551234567',
        twilioCallSid: 'CA_test_123',
        state: CallState.HUMAN_DETECTED,
        previousState: CallState.HOLD,
        conferenceName: null,
        stateChangedAt: Date.now(),
        createdAt: Date.now() - 60000,
        metadata: {},
      });

      const queue = await callQueue.getQueue(testSearchId);
      expect(queue.length).toBe(1);
      expect(queue[0]?.callId).toBe(testCallId);
    });

    it('should get next in queue', async () => {
      const next = await callQueue.getNextInQueue(testSearchId);

      expect(next).not.toBeNull();
      expect(next?.callId).toBe(testCallId);
    });

    it('should mark call as notified', async () => {
      await callQueue.markNotified(testSearchId, testCallId);

      const queue = await callQueue.getQueue(testSearchId);
      const call = queue.find((c) => c.callId === testCallId);
      expect(call?.notifiedAt).not.toBeNull();
    });

    it('should mark call as acknowledged', async () => {
      await callQueue.markAcknowledged(testSearchId, testCallId);

      const queue = await callQueue.getQueue(testSearchId);
      const call = queue.find((c) => c.callId === testCallId);
      expect(call?.acknowledgedAt).not.toBeNull();
    });

    it('should set connected call', async () => {
      await callQueue.setConnectedCall(testSearchId, {
        callId: testCallId,
        searchId: testSearchId,
        pharmacyName: 'Connected Pharmacy',
        connectedAt: Date.now(),
        patientCallSid: 'CA_patient_123',
      });

      const connected = await callQueue.getConnectedCall(testSearchId);
      expect(connected?.callId).toBe(testCallId);
    });

    it('should dequeue call after connecting', async () => {
      const queue = await callQueue.getQueue(testSearchId);
      const hasCall = queue.some((c) => c.callId === testCallId);
      expect(hasCall).toBe(false); // Should have been removed when connected
    });

    it('should get queue size', async () => {
      const size = await callQueue.getQueueSize(testSearchId);
      expect(typeof size).toBe('number');
    });

    it('should check if queue has waiting calls', async () => {
      const hasWaiting = await callQueue.hasWaitingCalls(testSearchId);
      expect(typeof hasWaiting).toBe('boolean');
    });
  });

  describe('Patient Timeout', () => {
    const testSearchId = 'timeout-search-' + Date.now();
    const testCallId = 'timeout-call-' + Date.now();

    it('should be an EventEmitter', () => {
      expect(patientTimeout).toBeInstanceOf(EventEmitter);
    });

    it('should set timeout duration', () => {
      patientTimeout.setTimeoutDuration(5000); // 5 seconds for testing
      // No assertion needed - just verify it doesn't throw
    });

    it('should start a timeout', async () => {
      await patientTimeout.startTimeout(testSearchId, testCallId, 'Timeout Test Pharmacy');

      const timeouts = await patientTimeout.getActiveTimeouts(testSearchId);
      expect(timeouts.length).toBe(1);
      expect(timeouts[0]?.callId).toBe(testCallId);
    });

    it('should get remaining time', async () => {
      const remaining = await patientTimeout.getRemainingTime(testSearchId, testCallId);

      expect(remaining).not.toBeNull();
      expect(remaining).toBeGreaterThan(0);
    });

    it('should extend timeout', async () => {
      const beforeExtend = await patientTimeout.getRemainingTime(testSearchId, testCallId);
      await patientTimeout.extendTimeout(testSearchId, testCallId, 10000);
      const afterExtend = await patientTimeout.getRemainingTime(testSearchId, testCallId);

      expect(afterExtend).toBeGreaterThan(beforeExtend ?? 0);
    });

    it('should acknowledge and cancel timeout', async () => {
      await patientTimeout.acknowledge(testSearchId, testCallId);

      const timeouts = await patientTimeout.getActiveTimeouts(testSearchId);
      const found = timeouts.find((t) => t.callId === testCallId);
      expect(found).toBeUndefined();
    });

    it('should emit acknowledged event', async () => {
      const newCallId = 'ack-test-' + Date.now();
      await patientTimeout.startTimeout(testSearchId, newCallId, 'Ack Test Pharmacy');

      const ackPromise = new Promise<void>((resolve) => {
        patientTimeout.once('acknowledged', (sId, cId) => {
          expect(sId).toBe(testSearchId);
          expect(cId).toBe(newCallId);
          resolve();
        });
      });

      await patientTimeout.acknowledge(testSearchId, newCallId);
      await ackPromise;
    });

    it('should detect expired timeouts', async () => {
      const expiredCallId = 'expired-test-' + Date.now();
      patientTimeout.setTimeoutDuration(100); // Very short timeout

      await patientTimeout.startTimeout(testSearchId, expiredCallId, 'Expired Test Pharmacy');

      // Wait for timeout to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      const isExpired = await patientTimeout.isExpired(testSearchId, expiredCallId);
      expect(isExpired).toBe(true);

      // Clean up
      await patientTimeout.clearAllTimeouts(testSearchId);
    });

    it('should clear all timeouts for a search', async () => {
      const clearSearchId = 'clear-search-' + Date.now();

      await patientTimeout.startTimeout(clearSearchId, 'call-1', 'Pharmacy 1');
      await patientTimeout.startTimeout(clearSearchId, 'call-2', 'Pharmacy 2');

      let timeouts = await patientTimeout.getActiveTimeouts(clearSearchId);
      expect(timeouts.length).toBe(2);

      await patientTimeout.clearAllTimeouts(clearSearchId);

      timeouts = await patientTimeout.getActiveTimeouts(clearSearchId);
      expect(timeouts.length).toBe(0);
    });
  });

  describe('Integration: Full State Flow', () => {
    it('should handle full call lifecycle: CREATED -> DIALING -> IVR -> HOLD -> HUMAN_DETECTED -> BRIDGING -> CONNECTED -> ENDING -> ENDED', async () => {
      const flowCallId = 'flow-test-' + Date.now();
      const flowSearchId = 'flow-search-' + Date.now();

      // Create
      await callStateMachine.createCall({
        callId: flowCallId,
        searchId: flowSearchId,
        pharmacyId: 'flow-pharmacy',
        pharmacyName: 'Flow Test Pharmacy',
        phoneNumber: '+15551234567',
      });

      let state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.CREATED);

      // DIALING
      await callStateMachine.transition(flowCallId, CallState.DIALING);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.DIALING);

      // IVR
      await callStateMachine.transition(flowCallId, CallState.IVR);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.IVR);

      // HOLD
      await callStateMachine.transition(flowCallId, CallState.HOLD);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.HOLD);

      // HUMAN_DETECTED
      await callStateMachine.transition(flowCallId, CallState.HUMAN_DETECTED);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.HUMAN_DETECTED);

      // BRIDGING
      await callStateMachine.transition(flowCallId, CallState.BRIDGING);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.BRIDGING);

      // CONNECTED
      await callStateMachine.transition(flowCallId, CallState.CONNECTED);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.CONNECTED);

      // ENDING
      await callStateMachine.transition(flowCallId, CallState.ENDING);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.ENDING);

      // ENDED
      await callStateMachine.transition(flowCallId, CallState.ENDED);
      state = await callStateMachine.getState(flowCallId);
      expect(state?.state).toBe(CallState.ENDED);

      // Verify full history
      const history = await callStateMachine.getTransitionHistory(flowCallId);
      expect(history.length).toBe(9); // Initial + 8 transitions
    });

    it('should handle IVR failure path: CREATED -> DIALING -> IVR -> IVR_FAILED -> ENDED', async () => {
      const failCallId = 'fail-test-' + Date.now();
      const failSearchId = 'fail-search-' + Date.now();

      await callStateMachine.createCall({
        callId: failCallId,
        searchId: failSearchId,
        pharmacyId: 'fail-pharmacy',
        pharmacyName: 'Fail Test Pharmacy',
        phoneNumber: '+15551234567',
      });

      await callStateMachine.transition(failCallId, CallState.DIALING);
      await callStateMachine.transition(failCallId, CallState.IVR);
      await callStateMachine.transition(failCallId, CallState.IVR_FAILED, {
        reason: 'Could not navigate IVR after 3 attempts',
      });

      let state = await callStateMachine.getState(failCallId);
      expect(state?.state).toBe(CallState.IVR_FAILED);

      await callStateMachine.transition(failCallId, CallState.ENDED);
      state = await callStateMachine.getState(failCallId);
      expect(state?.state).toBe(CallState.ENDED);
    });
  });
});
