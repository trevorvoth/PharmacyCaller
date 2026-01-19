import { redis, redisHelpers } from './redis.js';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import {
  CallState,
  CallStateData,
  StateTransitionEvent,
  VALID_TRANSITIONS,
  ACTIVE_STATES,
  HUMAN_READY_STATES,
  TERMINAL_STATES,
} from '../types/callStates.js';

const stateMachineLogger = logger.child({ service: 'call-state-machine' });

const CALL_STATE_PREFIX = 'call:state:';
const SEARCH_CALLS_PREFIX = 'search:calls:';
const CALL_HISTORY_PREFIX = 'call:history:';
const CALL_STATE_TTL = 60 * 60 * 24; // 24 hours

export interface CallStateMachineEvents {
  stateChanged: (event: StateTransitionEvent) => void;
  humanDetected: (callId: string, data: CallStateData) => void;
  callEnded: (callId: string, data: CallStateData) => void;
  callFailed: (callId: string, data: CallStateData, reason: string) => void;
}

class CallStateMachine extends EventEmitter {
  /**
   * Creates a new call state record
   */
  async createCall(params: {
    callId: string;
    searchId: string;
    pharmacyId: string;
    pharmacyName: string;
    phoneNumber: string;
    metadata?: Record<string, unknown>;
  }): Promise<CallStateData> {
    const { callId, searchId, pharmacyId, pharmacyName, phoneNumber, metadata = {} } = params;

    const now = Date.now();
    const callData: CallStateData = {
      callId,
      searchId,
      pharmacyId,
      pharmacyName,
      phoneNumber,
      state: CallState.CREATED,
      previousState: null,
      twilioCallSid: null,
      conferenceName: null,
      stateChangedAt: now,
      createdAt: now,
      metadata,
    };

    // Store call state
    await redisHelpers.setJson(`${CALL_STATE_PREFIX}${callId}`, callData, CALL_STATE_TTL);

    // Add to search's call list
    await redis.sadd(`${SEARCH_CALLS_PREFIX}${searchId}`, callId);
    await redis.expire(`${SEARCH_CALLS_PREFIX}${searchId}`, CALL_STATE_TTL);

    // Log transition
    await this.logTransition({
      callId,
      fromState: CallState.CREATED,
      toState: CallState.CREATED,
      timestamp: now,
      reason: 'Call created',
    });

    stateMachineLogger.info({
      callId,
      searchId,
      pharmacyId,
      state: CallState.CREATED,
    }, 'Call state created');

    return callData;
  }

  /**
   * Gets the current state of a call
   */
  async getState(callId: string): Promise<CallStateData | null> {
    return redisHelpers.getJson<CallStateData>(`${CALL_STATE_PREFIX}${callId}`);
  }

  /**
   * Validates if a state transition is allowed
   */
  isValidTransition(fromState: CallState, toState: CallState): boolean {
    const validTargets = VALID_TRANSITIONS[fromState];
    return validTargets?.includes(toState) ?? false;
  }

  /**
   * Transitions a call to a new state
   */
  async transition(
    callId: string,
    toState: CallState,
    options: {
      reason?: string;
      twilioCallSid?: string;
      conferenceName?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<CallStateData | null> {
    const { reason, twilioCallSid, conferenceName, metadata } = options;

    const currentData = await this.getState(callId);
    if (!currentData) {
      stateMachineLogger.warn({ callId, toState }, 'Cannot transition - call not found');
      return null;
    }

    const fromState = currentData.state;

    // Validate transition
    if (!this.isValidTransition(fromState, toState)) {
      stateMachineLogger.warn({
        callId,
        fromState,
        toState,
        reason: 'Invalid transition',
      }, 'Transition rejected');
      return null;
    }

    const now = Date.now();
    const updatedData: CallStateData = {
      ...currentData,
      state: toState,
      previousState: fromState,
      stateChangedAt: now,
      ...(twilioCallSid && { twilioCallSid }),
      ...(conferenceName && { conferenceName }),
      ...(metadata && { metadata: { ...currentData.metadata, ...metadata } }),
    };

    // Update state
    await redisHelpers.setJson(`${CALL_STATE_PREFIX}${callId}`, updatedData, CALL_STATE_TTL);

    // Log transition
    const transitionEvent: StateTransitionEvent = {
      callId,
      fromState,
      toState,
      timestamp: now,
      reason,
      metadata,
    };
    await this.logTransition(transitionEvent);

    stateMachineLogger.info({
      callId,
      fromState,
      toState,
      reason,
    }, 'Call state transitioned');

    // Emit events
    this.emit('stateChanged', transitionEvent);

    // Special event emissions
    if (toState === CallState.HUMAN_DETECTED) {
      this.emit('humanDetected', callId, updatedData);
    }

    if (TERMINAL_STATES.includes(toState)) {
      this.emit('callEnded', callId, updatedData);
    }

    if (toState === CallState.FAILED || toState === CallState.IVR_FAILED) {
      this.emit('callFailed', callId, updatedData, reason ?? 'Unknown');
    }

    return updatedData;
  }

  /**
   * Logs a state transition to history
   */
  private async logTransition(event: StateTransitionEvent): Promise<void> {
    const historyKey = `${CALL_HISTORY_PREFIX}${event.callId}`;
    await redis.rpush(historyKey, JSON.stringify(event));
    await redis.expire(historyKey, CALL_STATE_TTL);
  }

  /**
   * Gets the transition history for a call
   */
  async getTransitionHistory(callId: string): Promise<StateTransitionEvent[]> {
    const historyKey = `${CALL_HISTORY_PREFIX}${callId}`;
    const history = await redis.lrange(historyKey, 0, -1);

    return history.map((h: string) => JSON.parse(h) as StateTransitionEvent);
  }

  /**
   * Gets all calls for a search
   */
  async getSearchCalls(searchId: string): Promise<CallStateData[]> {
    const callIds = await redis.smembers(`${SEARCH_CALLS_PREFIX}${searchId}`);
    const calls: CallStateData[] = [];

    for (const callId of callIds) {
      const state = await this.getState(callId);
      if (state) {
        calls.push(state);
      }
    }

    return calls;
  }

  /**
   * Gets all active calls for a search
   */
  async getActiveSearchCalls(searchId: string): Promise<CallStateData[]> {
    const calls = await this.getSearchCalls(searchId);
    return calls.filter((c) => ACTIVE_STATES.includes(c.state));
  }

  /**
   * Gets calls with humans ready
   */
  async getHumanReadyCalls(searchId: string): Promise<CallStateData[]> {
    const calls = await this.getSearchCalls(searchId);
    return calls.filter((c) => HUMAN_READY_STATES.includes(c.state));
  }

  /**
   * Checks if any call in a search has a human ready
   */
  async hasHumanReady(searchId: string): Promise<boolean> {
    const humanReadyCalls = await this.getHumanReadyCalls(searchId);
    return humanReadyCalls.length > 0;
  }

  /**
   * Updates call metadata without changing state
   */
  async updateMetadata(
    callId: string,
    metadata: Record<string, unknown>
  ): Promise<CallStateData | null> {
    const currentData = await this.getState(callId);
    if (!currentData) {
      return null;
    }

    const updatedData: CallStateData = {
      ...currentData,
      metadata: { ...currentData.metadata, ...metadata },
    };

    await redisHelpers.setJson(`${CALL_STATE_PREFIX}${callId}`, updatedData, CALL_STATE_TTL);
    return updatedData;
  }

  /**
   * Sets the Twilio call SID for a call
   */
  async setTwilioCallSid(callId: string, twilioCallSid: string): Promise<void> {
    await this.updateMetadata(callId, { twilioCallSid });

    // Also update the main field
    const data = await this.getState(callId);
    if (data) {
      data.twilioCallSid = twilioCallSid;
      await redisHelpers.setJson(`${CALL_STATE_PREFIX}${callId}`, data, CALL_STATE_TTL);
    }
  }

  /**
   * Cleans up old call states
   */
  async cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    // This would be called by a cron job
    // For now, rely on Redis TTL expiration
    stateMachineLogger.debug({ olderThanMs }, 'Cleanup called - relying on Redis TTL');
    return 0;
  }
}

export const callStateMachine = new CallStateMachine();
