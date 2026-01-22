import { logger } from '../utils/logger.js';
import { callStateMachine } from './callStateMachine.js';
import { CallState } from '../types/callStates.js';
import { notificationService } from './notifications.js';
import { pharmacyTracker } from './pharmacyTracker.js';

const demoLogger = logger.child({ service: 'demo-simulator' });

// Simulated call scenarios
type CallScenario = 'human_answers' | 'voicemail' | 'no_answer' | 'busy';

interface SimulatedCall {
  callId: string;
  searchId: string;
  pharmacyId: string;
  pharmacyName: string;
  scenario: CallScenario;
  timeoutIds: NodeJS.Timeout[];
}

const activeSims: Map<string, SimulatedCall> = new Map();

// Random delay helper
function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

// Pick a random scenario with weighted probabilities
function pickScenario(): CallScenario {
  const rand = Math.random();
  if (rand < 0.5) return 'human_answers';  // 50% - human answers
  if (rand < 0.75) return 'voicemail';     // 25% - voicemail
  if (rand < 0.9) return 'no_answer';      // 15% - no answer
  return 'busy';                            // 10% - busy
}

export const demoSimulator = {
  /**
   * Simulate a pharmacy call
   */
  async simulateCall(params: {
    callId: string;
    searchId: string;
    pharmacyId: string;
    pharmacyName: string;
    phoneNumber: string;
  }): Promise<void> {
    const { callId, searchId, pharmacyId, pharmacyName, phoneNumber } = params;
    const scenario = pickScenario();

    demoLogger.info({
      callId,
      pharmacyName,
      scenario,
    }, 'Starting simulated call');

    const sim: SimulatedCall = {
      callId,
      searchId,
      pharmacyId,
      pharmacyName,
      scenario,
      timeoutIds: [],
    };

    activeSims.set(callId, sim);

    // Simulate call progression based on scenario
    switch (scenario) {
      case 'human_answers':
        await this.simulateHumanAnswers(sim);
        break;
      case 'voicemail':
        await this.simulateVoicemail(sim);
        break;
      case 'no_answer':
        await this.simulateNoAnswer(sim);
        break;
      case 'busy':
        await this.simulateBusy(sim);
        break;
    }
  },

  /**
   * Simulate: Phone rings -> IVR -> Hold -> Human answers
   */
  async simulateHumanAnswers(sim: SimulatedCall): Promise<void> {
    const { callId, searchId, pharmacyId, pharmacyName } = sim;

    // DIALING -> (2-4 sec) -> IVR
    const dialingDelay = randomDelay(2000, 4000);
    const t1 = setTimeout(async () => {
      await callStateMachine.transition(callId, CallState.IVR, {
        reason: 'Demo: IVR system detected',
      });
      await pharmacyTracker.updateFromCallState(searchId, callId, CallState.IVR);
      demoLogger.debug({ callId, pharmacyName }, 'Demo: Entered IVR');
    }, dialingDelay);
    sim.timeoutIds.push(t1);

    // IVR -> (3-6 sec) -> HOLD
    const ivrDelay = dialingDelay + randomDelay(3000, 6000);
    const t2 = setTimeout(async () => {
      await callStateMachine.transition(callId, CallState.HOLD, {
        reason: 'Demo: Navigated IVR, now on hold',
      });
      await pharmacyTracker.updateFromCallState(searchId, callId, CallState.HOLD);
      demoLogger.debug({ callId, pharmacyName }, 'Demo: On hold');
    }, ivrDelay);
    sim.timeoutIds.push(t2);

    // HOLD -> (5-15 sec) -> HUMAN_DETECTED
    const holdDelay = ivrDelay + randomDelay(5000, 15000);
    const t3 = setTimeout(async () => {
      await callStateMachine.transition(callId, CallState.HUMAN_DETECTED, {
        reason: 'Demo: Pharmacist answered',
      });
      await pharmacyTracker.updateFromCallState(searchId, callId, CallState.HUMAN_DETECTED);

      // Send notification to user
      const state = await callStateMachine.getState(callId);
      if (state) {
        await notificationService.sendPharmacistReady(searchId, {
          searchId,
          callId: state.callId,
          pharmacyId: state.pharmacyId,
          pharmacyName: state.pharmacyName,
          message: `A pharmacist at ${state.pharmacyName} is ready to speak with you!`,
        });
      }

      demoLogger.info({ callId, pharmacyName }, 'Demo: Human detected - pharmacist ready');
    }, holdDelay);
    sim.timeoutIds.push(t3);
  },

  /**
   * Simulate: Phone rings -> IVR -> Voicemail
   */
  async simulateVoicemail(sim: SimulatedCall): Promise<void> {
    const { callId, searchId, pharmacyId, pharmacyName } = sim;

    // DIALING -> (2-4 sec) -> IVR
    const dialingDelay = randomDelay(2000, 4000);
    const t1 = setTimeout(async () => {
      await callStateMachine.transition(callId, CallState.IVR, {
        reason: 'Demo: IVR system detected',
      });
      await pharmacyTracker.updateFromCallState(searchId, callId, CallState.IVR);
    }, dialingDelay);
    sim.timeoutIds.push(t1);

    // IVR -> (4-8 sec) -> VOICEMAIL
    const ivrDelay = dialingDelay + randomDelay(4000, 8000);
    const t2 = setTimeout(async () => {
      await callStateMachine.transition(callId, CallState.VOICEMAIL, {
        reason: 'Demo: Transferred to voicemail',
      });
      await pharmacyTracker.updateFromCallState(searchId, callId, CallState.VOICEMAIL);

      // Send notification
      const state = await callStateMachine.getState(callId);
      if (state) {
        await notificationService.sendVoicemailReady(searchId, {
          searchId,
          callId: state.callId,
          pharmacyId: state.pharmacyId,
          pharmacyName: state.pharmacyName,
          message: `Reached voicemail at ${state.pharmacyName}`,
        });
      }

      demoLogger.info({ callId, pharmacyName }, 'Demo: Voicemail reached');
    }, ivrDelay);
    sim.timeoutIds.push(t2);
  },

  /**
   * Simulate: Phone rings -> No answer -> Failed
   */
  async simulateNoAnswer(sim: SimulatedCall): Promise<void> {
    const { callId, searchId, pharmacyId, pharmacyName } = sim;

    // DIALING -> (15-25 sec) -> FAILED (no answer)
    const ringDelay = randomDelay(15000, 25000);
    const t1 = setTimeout(async () => {
      await callStateMachine.transition(callId, CallState.FAILED, {
        reason: 'Demo: No answer after 30 seconds',
      });
      await pharmacyTracker.updateFromCallState(searchId, callId, CallState.FAILED);
      demoLogger.info({ callId, pharmacyName }, 'Demo: No answer');
    }, ringDelay);
    sim.timeoutIds.push(t1);
  },

  /**
   * Simulate: Phone busy -> Failed
   */
  async simulateBusy(sim: SimulatedCall): Promise<void> {
    const { callId, searchId, pharmacyId, pharmacyName } = sim;

    // DIALING -> (1-2 sec) -> FAILED (busy)
    const busyDelay = randomDelay(1000, 2000);
    const t1 = setTimeout(async () => {
      await callStateMachine.transition(callId, CallState.FAILED, {
        reason: 'Demo: Line busy',
      });
      await pharmacyTracker.updateFromCallState(searchId, callId, CallState.FAILED);
      demoLogger.info({ callId, pharmacyName }, 'Demo: Line busy');
    }, busyDelay);
    sim.timeoutIds.push(t1);
  },

  /**
   * Cancel a simulated call
   */
  cancelSimulation(callId: string): void {
    const sim = activeSims.get(callId);
    if (sim) {
      for (const timeoutId of sim.timeoutIds) {
        clearTimeout(timeoutId);
      }
      activeSims.delete(callId);
      demoLogger.debug({ callId }, 'Demo simulation cancelled');
    }
  },

  /**
   * Cancel all simulations for a search
   */
  cancelSearchSimulations(searchId: string): void {
    for (const [callId, sim] of activeSims) {
      if (sim.searchId === searchId) {
        this.cancelSimulation(callId);
      }
    }
  },

  /**
   * Check if demo mode is active
   */
  isActive(): boolean {
    return activeSims.size > 0;
  },
};
