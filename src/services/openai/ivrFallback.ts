import { logger } from '../../utils/logger.js';
import { metrics, METRICS } from '../metrics.js';

const fallbackLogger = logger.child({ service: 'ivr-fallback' });

const MAX_IVR_ATTEMPTS = 3;
const IVR_TIMEOUT_MS = 60000; // 1 minute per navigation attempt

export interface IVRNavigationState {
  callId: string;
  pharmacyName: string;
  attempts: number;
  lastAttemptTime: number;
  errors: string[];
  status: 'navigating' | 'on_hold' | 'human_detected' | 'voicemail' | 'failed';
}

const navigationStates = new Map<string, IVRNavigationState>();

export const ivrFallback = {
  initNavigation(callId: string, pharmacyName: string): IVRNavigationState {
    const state: IVRNavigationState = {
      callId,
      pharmacyName,
      attempts: 0,
      lastAttemptTime: Date.now(),
      errors: [],
      status: 'navigating',
    };

    navigationStates.set(callId, state);
    fallbackLogger.info({ callId, pharmacyName }, 'IVR navigation initialized');

    return state;
  },

  getState(callId: string): IVRNavigationState | undefined {
    return navigationStates.get(callId);
  },

  recordAttempt(callId: string, error?: string): void {
    const state = navigationStates.get(callId);
    if (!state) {
      return;
    }

    state.attempts++;
    state.lastAttemptTime = Date.now();

    if (error) {
      state.errors.push(error);
    }

    fallbackLogger.info({
      callId,
      attempts: state.attempts,
      error,
    }, 'IVR navigation attempt recorded');
  },

  shouldRetry(callId: string): boolean {
    const state = navigationStates.get(callId);
    if (!state) {
      return false;
    }

    // Don't retry if already succeeded or explicitly failed
    if (state.status !== 'navigating') {
      return false;
    }

    // Check attempt limit
    if (state.attempts >= MAX_IVR_ATTEMPTS) {
      fallbackLogger.warn({
        callId,
        attempts: state.attempts,
        maxAttempts: MAX_IVR_ATTEMPTS,
      }, 'Max IVR attempts reached');
      return false;
    }

    // Check timeout
    const elapsed = Date.now() - state.lastAttemptTime;
    if (elapsed > IVR_TIMEOUT_MS) {
      fallbackLogger.warn({
        callId,
        elapsed,
        timeout: IVR_TIMEOUT_MS,
      }, 'IVR navigation timeout');
      return false;
    }

    return true;
  },

  async markFailed(callId: string): Promise<{
    shouldNotifyUser: boolean;
    message: string;
    errors: string[];
  }> {
    const state = navigationStates.get(callId);
    if (!state) {
      return {
        shouldNotifyUser: false,
        message: 'Unknown call',
        errors: [],
      };
    }

    state.status = 'failed';

    fallbackLogger.warn({
      callId,
      pharmacyName: state.pharmacyName,
      attempts: state.attempts,
      errors: state.errors,
    }, 'IVR navigation failed');

    // Record metrics
    await metrics.increment(METRICS.IVR_FAILED);

    return {
      shouldNotifyUser: true,
      message: `Unable to reach ${state.pharmacyName} pharmacy after ${state.attempts} attempts. The automated system could not be navigated.`,
      errors: state.errors,
    };
  },

  async markSuccess(callId: string, status: 'human_detected' | 'voicemail' | 'on_hold'): Promise<void> {
    const state = navigationStates.get(callId);
    if (!state) {
      return;
    }

    state.status = status;

    fallbackLogger.info({
      callId,
      pharmacyName: state.pharmacyName,
      status,
      attempts: state.attempts,
    }, 'IVR navigation succeeded');

    // Record metrics
    await metrics.increment(METRICS.IVR_SUCCESS);
  },

  cleanup(callId: string): void {
    navigationStates.delete(callId);
    fallbackLogger.debug({ callId }, 'IVR navigation state cleaned up');
  },

  getActiveNavigations(): Array<{ callId: string; state: IVRNavigationState }> {
    const active: Array<{ callId: string; state: IVRNavigationState }> = [];

    for (const [callId, state] of navigationStates) {
      if (state.status === 'navigating') {
        active.push({ callId, state });
      }
    }

    return active;
  },

  getFallbackMessage(pharmacyName: string): string {
    return `We were unable to navigate the automated phone system at ${pharmacyName}. ` +
      `This can happen with complex IVR menus. You may want to try calling this pharmacy directly.`;
  },
};
