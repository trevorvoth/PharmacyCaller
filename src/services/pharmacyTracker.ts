import { prisma } from '../db/client.js';
import { redis, redisHelpers } from './redis.js';
import { logger } from '../utils/logger.js';
import { callStateMachine } from './callStateMachine.js';
import { callQueue } from './callQueue.js';
import { notificationService } from './notifications.js';
import { metrics, METRICS } from './metrics.js';
import { CallState } from '../types/callStates.js';
import { PharmacyCallStatus, SearchStatus } from '@prisma/client';

const trackerLogger = logger.child({ service: 'pharmacy-tracker' });

const TRACKER_PREFIX = 'tracker:search:';
const TRACKER_TTL = 60 * 60 * 4; // 4 hours

export interface PharmacyStatus {
  pharmacyId: string;
  pharmacyName: string;
  address: string;
  phone: string;
  callStatus: PharmacyCallStatus;
  hasMedication: boolean | null;
  callId: string | null;
  callState: CallState | null;
  isHumanReady: boolean;
  isVoicemailReady: boolean;
  lastUpdated: number;
}

export interface SearchTrackerState {
  searchId: string;
  userId: string;
  medicationQuery: string;
  status: SearchStatus;
  pharmacies: PharmacyStatus[];
  activeCalls: number;
  connectedCalls: number;
  failedCalls: number;
  foundAt: string | null;
  createdAt: number;
  updatedAt: number;
}

export const pharmacyTracker = {
  /**
   * Initializes tracking for a new search
   */
  async initSearch(params: {
    searchId: string;
    userId: string;
    medicationQuery: string;
    pharmacyResults: Array<{
      id: string;
      pharmacyName: string;
      address: string;
      phone: string;
    }>;
  }): Promise<SearchTrackerState> {
    const { searchId, userId, medicationQuery, pharmacyResults } = params;

    trackerLogger.info({
      searchId,
      userId,
      pharmacyCount: pharmacyResults.length,
    }, 'Initializing pharmacy tracker');

    const pharmacies: PharmacyStatus[] = pharmacyResults.map((p) => ({
      pharmacyId: p.id,
      pharmacyName: p.pharmacyName,
      address: p.address,
      phone: p.phone,
      callStatus: PharmacyCallStatus.PENDING,
      hasMedication: null,
      callId: null,
      callState: null,
      isHumanReady: false,
      isVoicemailReady: false,
      lastUpdated: Date.now(),
    }));

    const state: SearchTrackerState = {
      searchId,
      userId,
      medicationQuery,
      status: SearchStatus.ACTIVE,
      pharmacies,
      activeCalls: 0,
      connectedCalls: 0,
      failedCalls: 0,
      foundAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveState(state);
    return state;
  },

  /**
   * Gets the current tracker state
   */
  async getState(searchId: string): Promise<SearchTrackerState | null> {
    const key = `${TRACKER_PREFIX}${searchId}`;
    return redisHelpers.getJson<SearchTrackerState>(key);
  },

  /**
   * Saves the tracker state
   */
  async saveState(state: SearchTrackerState): Promise<void> {
    const key = `${TRACKER_PREFIX}${state.searchId}`;
    state.updatedAt = Date.now();
    await redisHelpers.setJson(key, state, TRACKER_TTL);
  },

  /**
   * Updates pharmacy status when call is initiated
   */
  async updatePharmacyCallStarted(
    searchId: string,
    pharmacyId: string,
    callId: string
  ): Promise<void> {
    const state = await this.getState(searchId);
    if (!state) return;

    const pharmacy = state.pharmacies.find((p) => p.pharmacyId === pharmacyId);
    if (pharmacy) {
      pharmacy.callId = callId;
      pharmacy.callStatus = PharmacyCallStatus.CALLING;
      pharmacy.callState = CallState.DIALING;
      pharmacy.lastUpdated = Date.now();
      state.activeCalls++;
    }

    await this.saveState(state);

    // Update database
    await prisma.pharmacyResult.update({
      where: { id: pharmacyId },
      data: { callStatus: PharmacyCallStatus.CALLING },
    });

    trackerLogger.debug({
      searchId,
      pharmacyId,
      callId,
    }, 'Pharmacy call started');
  },

  /**
   * Updates pharmacy status from call state change
   */
  async updateFromCallState(
    searchId: string,
    callId: string,
    newState: CallState
  ): Promise<void> {
    const state = await this.getState(searchId);
    if (!state) return;

    const pharmacy = state.pharmacies.find((p) => p.callId === callId);
    if (!pharmacy) return;

    pharmacy.callState = newState;
    pharmacy.lastUpdated = Date.now();

    // Update call status based on state
    switch (newState) {
      case CallState.IVR:
      case CallState.HOLD:
        pharmacy.callStatus = PharmacyCallStatus.ON_HOLD;
        break;

      case CallState.HUMAN_DETECTED:
        pharmacy.callStatus = PharmacyCallStatus.READY;
        pharmacy.isHumanReady = true;
        break;

      case CallState.VOICEMAIL:
        pharmacy.callStatus = PharmacyCallStatus.READY;
        pharmacy.isVoicemailReady = true;
        break;

      case CallState.CONNECTED:
        pharmacy.callStatus = PharmacyCallStatus.CONNECTED;
        state.connectedCalls++;
        break;

      case CallState.IVR_FAILED:
      case CallState.FAILED:
        pharmacy.callStatus = PharmacyCallStatus.FAILED;
        state.failedCalls++;
        state.activeCalls = Math.max(0, state.activeCalls - 1);
        break;

      case CallState.ENDED:
        if (pharmacy.callStatus !== PharmacyCallStatus.COMPLETED) {
          pharmacy.callStatus = PharmacyCallStatus.COMPLETED;
        }
        state.activeCalls = Math.max(0, state.activeCalls - 1);
        break;
    }

    await this.saveState(state);

    // Update database
    await prisma.pharmacyResult.update({
      where: { id: pharmacy.pharmacyId },
      data: { callStatus: pharmacy.callStatus },
    });

    // Send status update notification
    await notificationService.sendSearchUpdate(searchId, {
      searchId,
      status: state.status === SearchStatus.ACTIVE ? 'active' :
              state.status === SearchStatus.COMPLETED ? 'completed' : 'cancelled',
      activeCalls: state.activeCalls,
      connectedCalls: state.connectedCalls,
      failedCalls: state.failedCalls,
    });
  },

  /**
   * Marks that medication was found at a pharmacy
   */
  async markMedicationFound(
    searchId: string,
    pharmacyId: string
  ): Promise<void> {
    const state = await this.getState(searchId);
    if (!state) return;

    const pharmacy = state.pharmacies.find((p) => p.pharmacyId === pharmacyId);
    if (!pharmacy) return;

    pharmacy.hasMedication = true;
    pharmacy.lastUpdated = Date.now();
    state.foundAt = pharmacy.pharmacyName;
    state.status = SearchStatus.COMPLETED;

    await this.saveState(state);

    // Update database
    await prisma.pharmacyResult.update({
      where: { id: pharmacyId },
      data: { hasMedication: true },
    });

    await prisma.pharmacySearch.update({
      where: { id: searchId },
      data: {
        status: SearchStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    // Track metric
    const foundMetric = METRICS.MEDICATION_FOUND;
    if (foundMetric) {
      await metrics.increment(foundMetric);
    }

    // End all other calls
    await callQueue.endAllCalls(searchId);

    trackerLogger.info({
      searchId,
      pharmacyId,
      pharmacyName: pharmacy.pharmacyName,
    }, 'Medication found - search completed');
  },

  /**
   * Marks that medication was NOT found at a pharmacy
   */
  async markMedicationNotFound(
    searchId: string,
    pharmacyId: string
  ): Promise<void> {
    const state = await this.getState(searchId);
    if (!state) return;

    const pharmacy = state.pharmacies.find((p) => p.pharmacyId === pharmacyId);
    if (!pharmacy) return;

    pharmacy.hasMedication = false;
    pharmacy.lastUpdated = Date.now();

    await this.saveState(state);

    // Update database
    await prisma.pharmacyResult.update({
      where: { id: pharmacyId },
      data: { hasMedication: false },
    });

    trackerLogger.info({
      searchId,
      pharmacyId,
      pharmacyName: pharmacy.pharmacyName,
    }, 'Medication not found at pharmacy');

    // Check if all pharmacies have been checked
    const allChecked = state.pharmacies.every(
      (p) => p.hasMedication !== null || p.callStatus === PharmacyCallStatus.FAILED
    );

    if (allChecked && !state.foundAt) {
      state.status = SearchStatus.COMPLETED;
      await this.saveState(state);

      await prisma.pharmacySearch.update({
        where: { id: searchId },
        data: {
          status: SearchStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      trackerLogger.info({
        searchId,
      }, 'All pharmacies checked - medication not found anywhere');
    }
  },

  /**
   * Cancels a search
   */
  async cancelSearch(searchId: string): Promise<void> {
    const state = await this.getState(searchId);
    if (!state) return;

    state.status = SearchStatus.CANCELLED;
    await this.saveState(state);

    // Update database
    await prisma.pharmacySearch.update({
      where: { id: searchId },
      data: {
        status: SearchStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    // End all calls
    await callQueue.endAllCalls(searchId);

    trackerLogger.info({ searchId }, 'Search cancelled');
  },

  /**
   * Gets a summary of the current search status
   */
  async getSearchSummary(searchId: string): Promise<{
    status: SearchStatus;
    pharmacies: Array<{
      id: string;
      name: string;
      callStatus: PharmacyCallStatus;
      hasMedication: boolean | null;
      isReady: boolean;
    }>;
    activeCalls: number;
    readyCalls: number;
    foundAt: string | null;
  } | null> {
    const state = await this.getState(searchId);
    if (!state) return null;

    const readyCalls = state.pharmacies.filter(
      (p) => p.isHumanReady || p.isVoicemailReady
    ).length;

    return {
      status: state.status,
      pharmacies: state.pharmacies.map((p) => ({
        id: p.pharmacyId,
        name: p.pharmacyName,
        callStatus: p.callStatus,
        hasMedication: p.hasMedication,
        isReady: p.isHumanReady || p.isVoicemailReady,
      })),
      activeCalls: state.activeCalls,
      readyCalls,
      foundAt: state.foundAt,
    };
  },

  /**
   * Gets pharmacies that have humans ready
   */
  async getReadyPharmacies(searchId: string): Promise<PharmacyStatus[]> {
    const state = await this.getState(searchId);
    if (!state) return [];

    return state.pharmacies.filter((p) => p.isHumanReady || p.isVoicemailReady);
  },

  /**
   * Gets the checklist data for the UI
   */
  async getChecklist(searchId: string): Promise<Array<{
    pharmacyId: string;
    pharmacyName: string;
    address: string;
    status: 'pending' | 'calling' | 'on_hold' | 'ready' | 'connected' | 'completed' | 'failed';
    hasMedication: boolean | null;
    isHumanReady: boolean;
    isVoicemailReady: boolean;
  }>> {
    const state = await this.getState(searchId);
    if (!state) return [];

    return state.pharmacies.map((p) => ({
      pharmacyId: p.pharmacyId,
      pharmacyName: p.pharmacyName,
      address: p.address,
      status: p.callStatus.toLowerCase() as 'pending' | 'calling' | 'on_hold' | 'ready' | 'connected' | 'completed' | 'failed',
      hasMedication: p.hasMedication,
      isHumanReady: p.isHumanReady,
      isVoicemailReady: p.isVoicemailReady,
    }));
  },
};
