import { redis, redisHelpers } from './redis.js';
import { logger } from '../utils/logger.js';
import { callStateMachine } from './callStateMachine.js';
import { CallState, CallStateData, ACTIVE_STATES } from '../types/callStates.js';
import { twilioClient } from './twilio/client.js';
import { generateSayTwiml } from './twilio/calls.js';

const queueLogger = logger.child({ service: 'call-queue' });

const QUEUE_PREFIX = 'queue:humans:';
const CONNECTED_PREFIX = 'connected:';
const QUEUE_TTL = 60 * 60; // 1 hour

export interface QueuedCall {
  callId: string;
  searchId: string;
  pharmacyId: string;
  pharmacyName: string;
  twilioCallSid: string;
  queuedAt: number;
  notifiedAt: number | null;
  acknowledgedAt: number | null;
}

export interface ConnectedCallInfo {
  callId: string;
  searchId: string;
  pharmacyName: string;
  connectedAt: number;
  patientCallSid: string | null;
}

const THANK_YOU_MESSAGE = "Thank you for holding. The patient has found what they needed at another pharmacy. Thank you for your time, have a great day!";

export const callQueue = {
  /**
   * Adds a call to the human-ready queue
   */
  async enqueue(callData: CallStateData): Promise<void> {
    const { callId, searchId, pharmacyId, pharmacyName, twilioCallSid } = callData;

    if (!twilioCallSid) {
      queueLogger.warn({ callId }, 'Cannot enqueue call without Twilio SID');
      return;
    }

    const queuedCall: QueuedCall = {
      callId,
      searchId,
      pharmacyId,
      pharmacyName,
      twilioCallSid,
      queuedAt: Date.now(),
      notifiedAt: null,
      acknowledgedAt: null,
    };

    const queueKey = `${QUEUE_PREFIX}${searchId}`;

    // Add to queue (sorted set with queue time as score)
    await redis.zadd(queueKey, queuedCall.queuedAt, JSON.stringify(queuedCall));
    await redis.expire(queueKey, QUEUE_TTL);

    queueLogger.info({
      callId,
      searchId,
      pharmacyName,
    }, 'Call added to human-ready queue');
  },

  /**
   * Removes a call from the queue
   */
  async dequeue(searchId: string, callId: string): Promise<void> {
    const queueKey = `${QUEUE_PREFIX}${searchId}`;
    const members = await redis.zrange(queueKey, 0, -1);

    for (const member of members) {
      const parsed = JSON.parse(member) as QueuedCall;
      if (parsed.callId === callId) {
        await redis.zrem(queueKey, member);
        queueLogger.debug({ callId, searchId }, 'Call removed from queue');
        break;
      }
    }
  },

  /**
   * Gets all queued calls for a search
   */
  async getQueue(searchId: string): Promise<QueuedCall[]> {
    const queueKey = `${QUEUE_PREFIX}${searchId}`;
    const members = await redis.zrange(queueKey, 0, -1);

    return members.map((m: string) => JSON.parse(m) as QueuedCall);
  },

  /**
   * Gets the next call in the queue (oldest first)
   */
  async getNextInQueue(searchId: string): Promise<QueuedCall | null> {
    const queueKey = `${QUEUE_PREFIX}${searchId}`;
    const members = await redis.zrange(queueKey, 0, 0);

    if (members.length === 0 || !members[0]) {
      return null;
    }

    return JSON.parse(members[0]) as QueuedCall;
  },

  /**
   * Marks a queued call as notified (patient has been told a human is ready)
   */
  async markNotified(searchId: string, callId: string): Promise<void> {
    const queue = await this.getQueue(searchId);
    const call = queue.find((c) => c.callId === callId);

    if (call) {
      call.notifiedAt = Date.now();
      await this.updateQueuedCall(searchId, call);
    }
  },

  /**
   * Marks a queued call as acknowledged by patient
   */
  async markAcknowledged(searchId: string, callId: string): Promise<void> {
    const queue = await this.getQueue(searchId);
    const call = queue.find((c) => c.callId === callId);

    if (call) {
      call.acknowledgedAt = Date.now();
      await this.updateQueuedCall(searchId, call);

      queueLogger.info({
        callId,
        searchId,
      }, 'Call acknowledged by patient');
    }
  },

  /**
   * Updates a queued call entry (internal helper)
   */
  async updateQueuedCall(searchId: string, call: QueuedCall): Promise<void> {
    const queueKey = `${QUEUE_PREFIX}${searchId}`;

    // Remove old entry and add updated one
    const members = await redis.zrange(queueKey, 0, -1);
    for (const member of members) {
      const parsed = JSON.parse(member) as QueuedCall;
      if (parsed.callId === call.callId) {
        await redis.zrem(queueKey, member);
        break;
      }
    }

    await redis.zadd(queueKey, call.queuedAt, JSON.stringify(call));
  },

  /**
   * Records that a patient is now connected to a call
   */
  async setConnectedCall(searchId: string, callInfo: ConnectedCallInfo): Promise<void> {
    const connectedKey = `${CONNECTED_PREFIX}${searchId}`;
    await redisHelpers.setJson(connectedKey, callInfo, QUEUE_TTL);

    // Remove from queue
    await this.dequeue(searchId, callInfo.callId);

    queueLogger.info({
      searchId,
      callId: callInfo.callId,
      pharmacyName: callInfo.pharmacyName,
    }, 'Patient connected to call');
  },

  /**
   * Gets the currently connected call for a search
   */
  async getConnectedCall(searchId: string): Promise<ConnectedCallInfo | null> {
    const connectedKey = `${CONNECTED_PREFIX}${searchId}`;
    return redisHelpers.getJson<ConnectedCallInfo>(connectedKey);
  },

  /**
   * Clears the connected call
   */
  async clearConnectedCall(searchId: string): Promise<void> {
    const connectedKey = `${CONNECTED_PREFIX}${searchId}`;
    await redis.del(connectedKey);
  },

  /**
   * Ends a call with a polite "thank you" message
   */
  async endCallPolitely(callId: string, twilioCallSid: string): Promise<void> {
    queueLogger.info({ callId, twilioCallSid }, 'Ending call politely');

    try {
      // Play thank you message before ending
      const twiml = generateSayTwiml(THANK_YOU_MESSAGE, 'Polly.Joanna');

      await twilioClient.calls(twilioCallSid).update({
        twiml,
      });

      // Wait a moment for the message to play, then end
      // The call will end naturally after the TwiML completes
      // Or we can set a timeout to forcefully end it

      setTimeout(async () => {
        try {
          await twilioClient.calls(twilioCallSid).update({
            status: 'completed',
          });
        } catch (e) {
          // Call may have already ended
          queueLogger.debug({ callId, twilioCallSid }, 'Call already ended');
        }
      }, 10000); // 10 seconds for message to play

      // Update state machine
      await callStateMachine.transition(callId, CallState.ENDING, {
        reason: 'Polite ending - patient found medication elsewhere',
      });
    } catch (error) {
      queueLogger.error({
        err: error,
        callId,
        twilioCallSid,
      }, 'Failed to end call politely');

      // Try to end anyway
      try {
        await twilioClient.calls(twilioCallSid).update({
          status: 'completed',
        });
      } catch (e) {
        // Ignore
      }
    }
  },

  /**
   * Ends all other connected/queued calls when patient joins one call
   * Keeps calls on hold running (they haven't reached a human yet)
   */
  async endOtherCallsOnJoin(searchId: string, joinedCallId: string): Promise<void> {
    queueLogger.info({
      searchId,
      joinedCallId,
    }, 'Ending other calls after patient joined');

    // Get all calls for this search
    const allCalls = await callStateMachine.getSearchCalls(searchId);

    for (const call of allCalls) {
      // Skip the call the patient joined
      if (call.callId === joinedCallId) {
        continue;
      }

      // Skip calls that are already ended/ending
      if ([CallState.ENDED, CallState.ENDING].includes(call.state)) {
        continue;
      }

      // Skip calls that are still on hold (keep them running in case patient needs a backup)
      if (call.state === CallState.HOLD) {
        queueLogger.debug({
          callId: call.callId,
          pharmacyName: call.pharmacyName,
        }, 'Keeping call on hold as backup');
        continue;
      }

      // End calls that have humans ready but patient didn't choose them
      if (call.twilioCallSid && [CallState.HUMAN_DETECTED, CallState.BRIDGING].includes(call.state)) {
        await this.endCallPolitely(call.callId, call.twilioCallSid);
      }
    }
  },

  /**
   * Ends all calls in a search (e.g., when search is cancelled)
   */
  async endAllCalls(searchId: string): Promise<void> {
    queueLogger.info({ searchId }, 'Ending all calls for search');

    const allCalls = await callStateMachine.getSearchCalls(searchId);

    for (const call of allCalls) {
      if (!ACTIVE_STATES.includes(call.state)) {
        continue;
      }

      if (call.twilioCallSid) {
        // If there's a human, end politely
        if ([CallState.HUMAN_DETECTED, CallState.BRIDGING, CallState.CONNECTED].includes(call.state)) {
          await this.endCallPolitely(call.callId, call.twilioCallSid);
        } else {
          // Otherwise just end the call
          try {
            await twilioClient.calls(call.twilioCallSid).update({
              status: 'completed',
            });
          } catch (e) {
            // Ignore errors - call may have already ended
          }
        }
      }

      await callStateMachine.transition(call.callId, CallState.ENDED, {
        reason: 'Search cancelled or completed',
      });
    }

    // Clear the queue
    const queueKey = `${QUEUE_PREFIX}${searchId}`;
    await redis.del(queueKey);
  },

  /**
   * Gets the queue size for a search
   */
  async getQueueSize(searchId: string): Promise<number> {
    const queueKey = `${QUEUE_PREFIX}${searchId}`;
    return redis.zcard(queueKey);
  },

  /**
   * Checks if any calls are waiting in the queue
   */
  async hasWaitingCalls(searchId: string): Promise<boolean> {
    const size = await this.getQueueSize(searchId);
    return size > 0;
  },
};
