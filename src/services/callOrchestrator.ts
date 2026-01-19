import { prisma } from '../db/client.js';
import { redis, redisHelpers } from './redis.js';
import { logger } from '../utils/logger.js';
import { initiateCall } from './twilio/calls.js';
import { generateConferenceName } from './twilio/conference.js';
import { callStateMachine } from './callStateMachine.js';
import { CallState, CallStateData } from '../types/callStates.js';
import { twilioConfig } from '../config/twilio.js';
import { env } from '../config/env.js';
import { v4 as uuidv4 } from 'uuid';

const orchestratorLogger = logger.child({ service: 'call-orchestrator' });

const SEARCH_STATE_PREFIX = 'search:state:';
const SEARCH_STATE_TTL = 60 * 60 * 4; // 4 hours

export interface PharmacyToCall {
  id: string;
  name: string;
  phoneNumber: string;
  address?: string;
}

export interface SearchState {
  searchId: string;
  userId: string;
  status: 'pending' | 'calling' | 'active' | 'completed' | 'cancelled';
  medicationQuery: string;
  pharmacies: PharmacyToCall[];
  callIds: string[];
  startedAt: number;
  completedAt: number | null;
  result: 'found' | 'not_found' | 'cancelled' | null;
  foundAt: string | null; // pharmacy name where medication was found
}

export interface CallProgress {
  callId: string;
  pharmacyId: string;
  pharmacyName: string;
  state: CallState;
  stateChangedAt: number;
  isHumanReady: boolean;
}

const MAX_PARALLEL_CALLS = 3;

export const callOrchestrator = {
  /**
   * Initiates parallel calls to multiple pharmacies
   */
  async startSearch(params: {
    userId: string;
    searchId: string;
    medicationQuery: string;
    pharmacies: PharmacyToCall[];
  }): Promise<SearchState> {
    const { userId, searchId, medicationQuery, pharmacies } = params;

    orchestratorLogger.info({
      searchId,
      userId,
      pharmacyCount: pharmacies.length,
    }, 'Starting pharmacy search');

    // Limit to max parallel calls
    const pharmaciesToCall = pharmacies.slice(0, MAX_PARALLEL_CALLS);

    // Initialize search state
    const searchState: SearchState = {
      searchId,
      userId,
      status: 'calling',
      medicationQuery,
      pharmacies: pharmaciesToCall,
      callIds: [],
      startedAt: Date.now(),
      completedAt: null,
      result: null,
      foundAt: null,
    };

    // Store search state
    await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);

    // Initiate calls in parallel
    const callPromises = pharmaciesToCall.map((pharmacy) =>
      this.initiatePharmacyCall(searchId, pharmacy, medicationQuery)
    );

    const results = await Promise.allSettled(callPromises);

    // Collect successful call IDs
    const callIds: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result && result.status === 'fulfilled' && result.value) {
        callIds.push(result.value.callId);
      } else if (result && result.status === 'rejected') {
        orchestratorLogger.error({
          searchId,
          pharmacy: pharmaciesToCall[i]?.name,
          error: result.reason,
        }, 'Failed to initiate call to pharmacy');
      }
    }

    // Update search state with call IDs
    searchState.callIds = callIds;
    searchState.status = callIds.length > 0 ? 'active' : 'completed';
    await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);

    orchestratorLogger.info({
      searchId,
      successfulCalls: callIds.length,
      totalAttempted: pharmaciesToCall.length,
    }, 'Search calls initiated');

    return searchState;
  },

  /**
   * Initiates a call to a single pharmacy
   */
  async initiatePharmacyCall(
    searchId: string,
    pharmacy: PharmacyToCall,
    medicationQuery: string
  ): Promise<CallStateData | null> {
    const callId = uuidv4();

    orchestratorLogger.info({
      searchId,
      callId,
      pharmacyName: pharmacy.name,
      phoneNumber: pharmacy.phoneNumber,
    }, 'Initiating call to pharmacy');

    try {
      // Create call state record
      const callState = await callStateMachine.createCall({
        callId,
        searchId,
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        phoneNumber: pharmacy.phoneNumber,
        metadata: {
          medicationQuery,
          pharmacyAddress: pharmacy.address,
        },
      });

      // Generate conference name for this call
      const conferenceName = generateConferenceName(searchId, pharmacy.id);

      // Transition to DIALING
      await callStateMachine.transition(callId, CallState.DIALING, {
        reason: 'Initiating Twilio call',
        conferenceName,
      });

      // Build webhook URLs
      const baseUrl = env.WEBHOOK_BASE_URL || `https://${env.HOST}:${env.PORT}`;
      const webhookUrl = `${baseUrl}/webhooks/twilio/voice?callId=${callId}&searchId=${searchId}`;
      const statusCallbackUrl = `${baseUrl}/webhooks/twilio/status?callId=${callId}`;

      // Initiate the actual Twilio call
      const result = await initiateCall({
        to: pharmacy.phoneNumber,
        webhookUrl,
        statusCallbackUrl,
        callerId: twilioConfig.phoneNumber,
        machineDetection: 'Enable',
      });

      // Update call state with Twilio SID
      await callStateMachine.setTwilioCallSid(callId, result.callSid);

      orchestratorLogger.info({
        callId,
        twilioCallSid: result.callSid,
        pharmacyName: pharmacy.name,
      }, 'Twilio call initiated successfully');

      return callStateMachine.getState(callId);
    } catch (error) {
      orchestratorLogger.error({
        callId,
        searchId,
        pharmacyName: pharmacy.name,
        err: error,
      }, 'Failed to initiate pharmacy call');

      // Transition to FAILED
      await callStateMachine.transition(callId, CallState.FAILED, {
        reason: error instanceof Error ? error.message : 'Unknown error',
      });

      return null;
    }
  },

  /**
   * Gets the current state of a search
   */
  async getSearchState(searchId: string): Promise<SearchState | null> {
    return redisHelpers.getJson<SearchState>(`${SEARCH_STATE_PREFIX}${searchId}`);
  },

  /**
   * Gets progress for all calls in a search
   */
  async getCallProgress(searchId: string): Promise<CallProgress[]> {
    const calls = await callStateMachine.getSearchCalls(searchId);

    return calls.map((call) => ({
      callId: call.callId,
      pharmacyId: call.pharmacyId,
      pharmacyName: call.pharmacyName,
      state: call.state,
      stateChangedAt: call.stateChangedAt,
      isHumanReady: [
        CallState.HUMAN_DETECTED,
        CallState.BRIDGING,
        CallState.CONNECTED,
      ].includes(call.state),
    }));
  },

  /**
   * Marks a search as completed (medication found)
   */
  async markFound(searchId: string, pharmacyName: string): Promise<SearchState | null> {
    const searchState = await this.getSearchState(searchId);
    if (!searchState) {
      return null;
    }

    searchState.status = 'completed';
    searchState.completedAt = Date.now();
    searchState.result = 'found';
    searchState.foundAt = pharmacyName;

    await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);

    orchestratorLogger.info({
      searchId,
      pharmacyName,
    }, 'Medication found - search completed');

    return searchState;
  },

  /**
   * Marks a search as completed (medication not found at all pharmacies)
   */
  async markNotFound(searchId: string): Promise<SearchState | null> {
    const searchState = await this.getSearchState(searchId);
    if (!searchState) {
      return null;
    }

    searchState.status = 'completed';
    searchState.completedAt = Date.now();
    searchState.result = 'not_found';

    await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);

    orchestratorLogger.info({ searchId }, 'Medication not found at any pharmacy');

    return searchState;
  },

  /**
   * Cancels a search and ends all active calls
   */
  async cancelSearch(searchId: string): Promise<SearchState | null> {
    const searchState = await this.getSearchState(searchId);
    if (!searchState) {
      return null;
    }

    orchestratorLogger.info({ searchId }, 'Cancelling search');

    // Get all active calls and transition them to ENDING
    const activeCalls = await callStateMachine.getActiveSearchCalls(searchId);
    for (const call of activeCalls) {
      await callStateMachine.transition(call.callId, CallState.ENDING, {
        reason: 'Search cancelled',
      });
    }

    searchState.status = 'cancelled';
    searchState.completedAt = Date.now();
    searchState.result = 'cancelled';

    await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);

    return searchState;
  },

  /**
   * Checks if a search has any calls with humans ready
   */
  async hasHumansReady(searchId: string): Promise<boolean> {
    return callStateMachine.hasHumanReady(searchId);
  },

  /**
   * Gets the first call with a human ready
   */
  async getNextHumanReadyCall(searchId: string): Promise<CallStateData | null> {
    const humanReadyCalls = await callStateMachine.getHumanReadyCalls(searchId);

    // Sort by state changed time (earliest first)
    humanReadyCalls.sort((a, b) => a.stateChangedAt - b.stateChangedAt);

    return humanReadyCalls[0] ?? null;
  },

  /**
   * Updates the database with search results
   */
  async persistSearchResult(searchId: string): Promise<void> {
    const searchState = await this.getSearchState(searchId);
    if (!searchState) {
      return;
    }

    try {
      await prisma.pharmacySearch.update({
        where: { id: searchId },
        data: {
          completed: true,
          completedAt: searchState.completedAt ? new Date(searchState.completedAt) : new Date(),
        },
      });

      orchestratorLogger.info({ searchId }, 'Search result persisted to database');
    } catch (error) {
      orchestratorLogger.error({ err: error, searchId }, 'Failed to persist search result');
    }
  },
};
