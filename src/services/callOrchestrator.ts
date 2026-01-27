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
import { demoSimulator } from './demoSimulator.js';
import { pharmacyTracker } from './pharmacyTracker.js';
import { pharmacySearchService } from './pharmacySearch.js';

const orchestratorLogger = logger.child({ service: 'call-orchestrator' });

const SEARCH_STATE_PREFIX = 'search:state:';
const SEARCH_STATE_TTL = 60 * 60 * 4; // 4 hours

export interface PharmacyToCall {
  id: string;
  placeId?: string; // Google Places ID (for reserves that need DB records created)
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

const MAX_PARALLEL_CALLS = 1;

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
      pharmacies, // Store all pharmacies so we can call them sequentially
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
      demoMode: env.DEMO_MODE,
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
        reason: env.DEMO_MODE ? 'Demo: Initiating simulated call' : 'Initiating Twilio call',
        conferenceName,
      });

      // Update pharmacy tracker with the call ID - this is critical for status updates
      await pharmacyTracker.updatePharmacyCallStarted(searchId, pharmacy.id, callId);

      // Use demo simulator or real Twilio
      if (env.DEMO_MODE) {
        // Start simulated call (async - runs in background)
        void demoSimulator.simulateCall({
          callId,
          searchId,
          pharmacyId: pharmacy.id,
          pharmacyName: pharmacy.name,
          phoneNumber: pharmacy.phoneNumber,
        });

        orchestratorLogger.info({
          callId,
          pharmacyName: pharmacy.name,
        }, 'Demo call simulation started');

        return callStateMachine.getState(callId);
      }

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
          status: 'COMPLETED',
          completedAt: searchState.completedAt ? new Date(searchState.completedAt) : new Date(),
        },
      });

      orchestratorLogger.info({ searchId }, 'Search result persisted to database');
    } catch (error) {
      orchestratorLogger.error({ err: error, searchId }, 'Failed to persist search result');
    }
  },
  /**
   * Starts calling the next pending pharmacy in the search
   */
  async startNextCall(searchId: string): Promise<boolean> {
    const searchState = await this.getSearchState(searchId);
    if (!searchState || searchState.status === 'completed' || searchState.status === 'cancelled') {
      return false;
    }

    // Get tracker state to find pending pharmacies
    const trackerState = await pharmacyTracker.getState(searchId);
    if (!trackerState) {
      return false;
    }

    // First, check if there are pending pharmacies already in the tracker
    let pendingPharmacy = trackerState.pharmacies.find(
      (p) => !p.callId && p.callStatus === 'PENDING'
    );

    let pharmacyToCall: PharmacyToCall | undefined;

    if (pendingPharmacy) {
      // Found a pending pharmacy in tracker
      pharmacyToCall = searchState.pharmacies.find((p) => p.id === pendingPharmacy!.pharmacyId);
    } else {
      // No pending pharmacies in tracker - add one from reserves
      const trackedIds = new Set(trackerState.pharmacies.map((p) => p.pharmacyId));
      const reservePharmacy = searchState.pharmacies.find((p) => !trackedIds.has(p.id));

      if (reservePharmacy) {
        orchestratorLogger.info({
          searchId,
          pharmacyName: reservePharmacy.name,
        }, 'Adding reserve pharmacy to search');

        // Add to database first to get the Prisma-generated ID
        const dbRecord = await prisma.pharmacyResult.create({
          data: {
            searchId,
            pharmacyName: reservePharmacy.name,
            address: reservePharmacy.address || '',
            phone: reservePharmacy.phoneNumber,
            latitude: 0,
            longitude: 0,
            placeId: reservePharmacy.placeId,
          },
        });

        // Add to tracker with the Prisma ID
        await pharmacyTracker.addPharmacy(searchId, {
          id: dbRecord.id,
          pharmacyName: reservePharmacy.name,
          address: reservePharmacy.address || '',
          phone: reservePharmacy.phoneNumber,
        });

        // Update pharmacyToCall to use the Prisma ID
        pharmacyToCall = {
          ...reservePharmacy,
          id: dbRecord.id,
        };
      } else {
        // No reserves left - check if we should fetch more from pagination
        await this.checkAndFetchMorePharmacies(searchId, searchState, trackerState);

        // Try again to find a pharmacy after fetching
        const updatedSearchState = await this.getSearchState(searchId);
        if (updatedSearchState) {
          const updatedTrackedIds = new Set(trackerState.pharmacies.map((p) => p.pharmacyId));
          const newReserve = updatedSearchState.pharmacies.find((p) => !updatedTrackedIds.has(p.id));
          if (newReserve) {
            const dbRecord = await prisma.pharmacyResult.create({
              data: {
                searchId,
                pharmacyName: newReserve.name,
                address: newReserve.address || '',
                phone: newReserve.phoneNumber,
                latitude: 0,
                longitude: 0,
                placeId: newReserve.placeId,
              },
            });
            await pharmacyTracker.addPharmacy(searchId, {
              id: dbRecord.id,
              pharmacyName: newReserve.name,
              address: newReserve.address || '',
              phone: newReserve.phoneNumber,
            });
            pharmacyToCall = { ...newReserve, id: dbRecord.id };
          }
        }
      }
    }

    if (!pharmacyToCall) {
      orchestratorLogger.info({ searchId }, 'No more pharmacies available to call');
      return false;
    }

    orchestratorLogger.info({
      searchId,
      pharmacyName: pharmacyToCall.name,
    }, 'Starting next pharmacy call');

    // Initiate the call
    const result = await this.initiatePharmacyCall(searchId, pharmacyToCall, searchState.medicationQuery);

    if (result) {
      searchState.callIds.push(result.callId);
      await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);
    }

    return !!result;
  },

  /**
   * Checks if we need more pharmacies and fetches them via pagination
   */
  async checkAndFetchMorePharmacies(
    searchId: string,
    searchState: SearchState,
    trackerState: { pharmacies: Array<{ pharmacyId: string; callStatus: string }> }
  ): Promise<void> {
    // Count remaining reserves (pharmacies in searchState but not in tracker)
    const trackedIds = new Set(trackerState.pharmacies.map((p) => p.pharmacyId));
    const remainingReserves = searchState.pharmacies.filter((p) => !trackedIds.has(p.id));

    // First, add any existing reserves to the tracker (show in UI)
    // This handles the initial batch of extras from the first API call
    for (const reserve of remainingReserves) {
      // Create DB record if needed (check if it has a placeId - reserves use Google Places ID)
      if (reserve.placeId) {
        const dbRecord = await prisma.pharmacyResult.create({
          data: {
            searchId,
            pharmacyName: reserve.name,
            address: reserve.address || '',
            phone: reserve.phoneNumber,
            latitude: 0,
            longitude: 0,
            placeId: reserve.placeId,
          },
        });

        // Add to tracker (shows in UI)
        await pharmacyTracker.addPharmacy(searchId, {
          id: dbRecord.id,
          pharmacyName: reserve.name,
          address: reserve.address || '',
          phone: reserve.phoneNumber,
        });

        // Update searchState with the Prisma ID
        reserve.id = dbRecord.id;
      }
    }

    // Save updated searchState with Prisma IDs
    if (remainingReserves.length > 0) {
      await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);
      orchestratorLogger.info({
        searchId,
        addedToUI: remainingReserves.length,
      }, 'Added remaining reserves to UI');
    }

    // If we still have less than 3 reserves after showing existing ones, try to fetch more
    if (remainingReserves.length < 3) {
      orchestratorLogger.info({
        searchId,
        remainingReservesCount: remainingReserves.length,
      }, 'Reserves running low, attempting to fetch more pharmacies');

      // Check if pagination is available
      const hasMore = await pharmacySearchService.hasMorePages(searchId);
      if (!hasMore) {
        orchestratorLogger.info({ searchId }, 'No more pages available from Google Places API');
        return;
      }

      // Fetch next page
      const nextPage = await pharmacySearchService.fetchNextPage(searchId);
      if (!nextPage || nextPage.pharmacies.length === 0) {
        orchestratorLogger.info({ searchId }, 'No additional pharmacies found in next page');
        return;
      }

      // Create DB records and add to tracker so they show in UI immediately
      const newPharmacies: PharmacyToCall[] = [];
      for (const p of nextPage.pharmacies) {
        // Create DB record (all pharmacies, including those without phones)
        const dbRecord = await prisma.pharmacyResult.create({
          data: {
            searchId,
            pharmacyName: p.name,
            address: p.address,
            phone: p.phone, // Can be null for phoneless pharmacies
            latitude: p.latitude,
            longitude: p.longitude,
            placeId: p.id,
            chain: p.chain,
          },
        });

        // Add to tracker (shows in UI - all pharmacies)
        await pharmacyTracker.addPharmacy(searchId, {
          id: dbRecord.id,
          pharmacyName: p.name,
          address: p.address,
          phone: p.phone ?? undefined,
        });

        // Only add pharmacies WITH phone numbers to search state for calling
        if (p.phone) {
          newPharmacies.push({
            id: dbRecord.id,
            placeId: p.id,
            name: p.name,
            phoneNumber: p.phone,
            address: p.address,
          });
        }
      }

      searchState.pharmacies.push(...newPharmacies);
      await redisHelpers.setJson(`${SEARCH_STATE_PREFIX}${searchId}`, searchState, SEARCH_STATE_TTL);

      orchestratorLogger.info({
        searchId,
        newPharmaciesCount: newPharmacies.length,
        totalPharmacies: searchState.pharmacies.length,
      }, 'Added new pharmacies from pagination (visible in UI)');
    }
  },
};
