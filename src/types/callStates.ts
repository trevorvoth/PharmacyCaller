/**
 * Call States - Represents the lifecycle of a pharmacy call
 *
 * Flow:
 * CREATED -> DIALING -> IVR -> HOLD -> HUMAN_DETECTED -> BRIDGING -> CONNECTED -> ENDING -> ENDED
 *                   \-> IVR_FAILED -> ENDED
 *                   \-> VOICEMAIL -> ENDED
 *                   \-> FAILED -> ENDED
 */

export enum CallState {
  /** Call record created but not yet initiated */
  CREATED = 'CREATED',

  /** Call is being dialed out to the pharmacy */
  DIALING = 'DIALING',

  /** AI is navigating the IVR/phone menu */
  IVR = 'IVR',

  /** IVR navigation failed after max attempts */
  IVR_FAILED = 'IVR_FAILED',

  /** AI successfully navigated, waiting on hold for human */
  HOLD = 'HOLD',

  /** Human pharmacist has answered */
  HUMAN_DETECTED = 'HUMAN_DETECTED',

  /** Reached voicemail */
  VOICEMAIL = 'VOICEMAIL',

  /** Call failed (network error, busy, no answer) */
  FAILED = 'FAILED',

  /** Patient is being connected to the pharmacist */
  BRIDGING = 'BRIDGING',

  /** Patient and pharmacist are connected */
  CONNECTED = 'CONNECTED',

  /** Call is being politely ended */
  ENDING = 'ENDING',

  /** Call has ended */
  ENDED = 'ENDED',
}

/**
 * Valid state transitions - defines the state machine
 */
export const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  [CallState.CREATED]: [CallState.DIALING, CallState.FAILED],
  [CallState.DIALING]: [CallState.IVR, CallState.FAILED, CallState.ENDED],
  [CallState.IVR]: [CallState.HOLD, CallState.IVR_FAILED, CallState.HUMAN_DETECTED, CallState.VOICEMAIL, CallState.FAILED],
  [CallState.IVR_FAILED]: [CallState.ENDING, CallState.ENDED],
  [CallState.HOLD]: [CallState.HUMAN_DETECTED, CallState.ENDING, CallState.ENDED, CallState.FAILED],
  [CallState.HUMAN_DETECTED]: [CallState.BRIDGING, CallState.ENDING, CallState.ENDED],
  [CallState.VOICEMAIL]: [CallState.ENDING, CallState.ENDED],
  [CallState.FAILED]: [CallState.ENDED],
  [CallState.BRIDGING]: [CallState.CONNECTED, CallState.ENDING, CallState.ENDED, CallState.FAILED],
  [CallState.CONNECTED]: [CallState.ENDING, CallState.ENDED],
  [CallState.ENDING]: [CallState.ENDED],
  [CallState.ENDED]: [], // Terminal state
};

/**
 * States that indicate a call is still active
 */
export const ACTIVE_STATES: CallState[] = [
  CallState.CREATED,
  CallState.DIALING,
  CallState.IVR,
  CallState.HOLD,
  CallState.HUMAN_DETECTED,
  CallState.BRIDGING,
  CallState.CONNECTED,
  CallState.ENDING,
];

/**
 * States that indicate a call has a human ready
 */
export const HUMAN_READY_STATES: CallState[] = [
  CallState.HUMAN_DETECTED,
  CallState.BRIDGING,
  CallState.CONNECTED,
];

/**
 * States that indicate a call can be ended politely
 */
export const ENDABLE_STATES: CallState[] = [
  CallState.IVR,
  CallState.HOLD,
  CallState.HUMAN_DETECTED,
  CallState.BRIDGING,
  CallState.CONNECTED,
];

/**
 * Terminal states - call is complete
 */
export const TERMINAL_STATES: CallState[] = [
  CallState.ENDED,
];

/**
 * Failed states - call did not reach human
 */
export const FAILED_STATES: CallState[] = [
  CallState.IVR_FAILED,
  CallState.VOICEMAIL,
  CallState.FAILED,
];

export interface CallStateData {
  callId: string;
  searchId: string;
  pharmacyId: string;
  pharmacyName: string;
  phoneNumber: string;
  state: CallState;
  previousState: CallState | null;
  twilioCallSid: string | null;
  conferenceName: string | null;
  stateChangedAt: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface StateTransitionEvent {
  callId: string;
  fromState: CallState;
  toState: CallState;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}
