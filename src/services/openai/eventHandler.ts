import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import { callStateMachine } from '../callStateMachine.js';
import { CallState } from '../../types/callStates.js';
import { ivrFallback } from './ivrFallback.js';
import { notificationService } from '../notifications.js';
import { metrics, METRICS } from '../metrics.js';

const eventLogger = logger.child({ service: 'openai-event-handler' });

/**
 * Detection types from OpenAI Realtime AI analysis
 */
export enum DetectionType {
  HUMAN_DETECTED = 'human_detected',
  VOICEMAIL_DETECTED = 'voicemail_detected',
  IVR_PROMPT = 'ivr_prompt',
  IVR_FAILED = 'ivr_failed',
  HOLD_MUSIC = 'hold_music',
  HOLD_MESSAGE = 'hold_message',
  HANG_UP = 'hang_up',
}

/**
 * Event payload from OpenAI Realtime function calls
 */
export interface AIDetectionEvent {
  callId: string;
  searchId: string;
  detectionType: DetectionType;
  confidence: number;
  transcript?: string;
  context?: string;
  timestamp: number;
}

/**
 * Internal events emitted by the handler
 */
export interface EventHandlerEvents {
  humanDetected: (event: AIDetectionEvent) => void;
  voicemailDetected: (event: AIDetectionEvent) => void;
  ivrFailed: (event: AIDetectionEvent) => void;
  holdDetected: (event: AIDetectionEvent) => void;
  callEnded: (event: AIDetectionEvent) => void;
}

/**
 * OpenAI Realtime Event Handler
 *
 * Processes AI-detected events from the realtime voice conversation
 * and triggers appropriate state transitions and notifications
 */
class OpenAIEventHandler extends EventEmitter {
  /**
   * Process a detection event from the OpenAI Realtime AI
   */
  async processDetection(event: AIDetectionEvent): Promise<void> {
    eventLogger.info({
      callId: event.callId,
      type: event.detectionType,
      confidence: event.confidence,
    }, 'Processing AI detection event');

    // Validate confidence threshold
    if (event.confidence < 0.7 && event.detectionType !== DetectionType.IVR_FAILED) {
      eventLogger.debug({
        callId: event.callId,
        type: event.detectionType,
        confidence: event.confidence,
      }, 'Low confidence detection ignored');
      return;
    }

    switch (event.detectionType) {
      case DetectionType.HUMAN_DETECTED:
        await this.handleHumanDetected(event);
        break;

      case DetectionType.VOICEMAIL_DETECTED:
        await this.handleVoicemailDetected(event);
        break;

      case DetectionType.IVR_FAILED:
        await this.handleIVRFailed(event);
        break;

      case DetectionType.HOLD_MUSIC:
      case DetectionType.HOLD_MESSAGE:
        await this.handleHoldDetected(event);
        break;

      case DetectionType.HANG_UP:
        await this.handleHangUp(event);
        break;

      case DetectionType.IVR_PROMPT:
        // IVR prompts are handled by the AI automatically
        await this.handleIVRPrompt(event);
        break;

      default:
        eventLogger.warn({
          callId: event.callId,
          type: event.detectionType,
        }, 'Unknown detection type');
    }
  }

  /**
   * Task 5.6: Handle "human_detected" event from OpenAI AI
   *
   * This is triggered when the AI detects that a real human pharmacist
   * has answered the call (not IVR, not hold music)
   */
  private async handleHumanDetected(event: AIDetectionEvent): Promise<void> {
    eventLogger.info({
      callId: event.callId,
      searchId: event.searchId,
      confidence: event.confidence,
      transcript: event.transcript,
    }, 'Human pharmacist detected');

    const callData = await callStateMachine.getState(event.callId);
    if (!callData) {
      eventLogger.warn({ callId: event.callId }, 'Call not found for human detection');
      return;
    }

    // Mark IVR navigation as successful
    await ivrFallback.markSuccess(event.callId, 'human_detected');

    // Transition call state
    const updated = await callStateMachine.transition(
      event.callId,
      CallState.HUMAN_DETECTED,
      {
        reason: 'AI detected human pharmacist',
        metadata: {
          detectionConfidence: event.confidence,
          transcript: event.transcript,
        },
      }
    );

    if (updated) {
      // Track metric
      const humanDetectedMetric = METRICS.HUMAN_DETECTED;
      if (humanDetectedMetric) {
        await metrics.increment(humanDetectedMetric);
      }

      // Send notification to patient
      await notificationService.sendPharmacistReady(event.searchId, {
        searchId: event.searchId,
        callId: event.callId,
        pharmacyId: callData.pharmacyId,
        pharmacyName: callData.pharmacyName,
        message: `A pharmacist at ${callData.pharmacyName} is ready to speak with you.`,
      });

      // Emit internal event
      this.emit('humanDetected', event);
    }
  }

  /**
   * Task 5.7: Handle "voicemail_detected" event
   *
   * Triggered when the AI detects that the call has gone to voicemail
   */
  private async handleVoicemailDetected(event: AIDetectionEvent): Promise<void> {
    eventLogger.info({
      callId: event.callId,
      searchId: event.searchId,
      confidence: event.confidence,
    }, 'Voicemail detected');

    const callData = await callStateMachine.getState(event.callId);
    if (!callData) {
      eventLogger.warn({ callId: event.callId }, 'Call not found for voicemail detection');
      return;
    }

    // Mark IVR as reaching voicemail
    await ivrFallback.markSuccess(event.callId, 'voicemail');

    // Transition call state
    const updated = await callStateMachine.transition(
      event.callId,
      CallState.VOICEMAIL,
      {
        reason: 'AI detected voicemail',
        metadata: {
          detectionConfidence: event.confidence,
        },
      }
    );

    if (updated) {
      // Track metric
      const voicemailMetric = METRICS.VOICEMAIL_DETECTED;
      if (voicemailMetric) {
        await metrics.increment(voicemailMetric);
      }

      // Send notification to patient - they can leave a message
      await notificationService.sendVoicemailReady(event.searchId, {
        searchId: event.searchId,
        callId: event.callId,
        pharmacyId: callData.pharmacyId,
        pharmacyName: callData.pharmacyName,
        message: `Reached voicemail at ${callData.pharmacyName}. You can leave a message if you'd like.`,
      });

      // Emit internal event
      this.emit('voicemailDetected', event);
    }
  }

  /**
   * Task 5.8: Handle "ivr_failed" event
   *
   * Triggered when the AI cannot navigate the IVR after multiple attempts
   */
  private async handleIVRFailed(event: AIDetectionEvent): Promise<void> {
    eventLogger.warn({
      callId: event.callId,
      searchId: event.searchId,
      context: event.context,
    }, 'IVR navigation failed');

    const callData = await callStateMachine.getState(event.callId);
    if (!callData) {
      eventLogger.warn({ callId: event.callId }, 'Call not found for IVR failure');
      return;
    }

    // Check if we should retry
    const shouldRetry = ivrFallback.shouldRetry(event.callId);

    if (shouldRetry) {
      // Record the attempt
      ivrFallback.recordAttempt(event.callId, event.context);
      eventLogger.info({
        callId: event.callId,
      }, 'IVR navigation will retry');
      return;
    }

    // Mark as failed
    const failure = await ivrFallback.markFailed(event.callId);

    // Transition call state to IVR_FAILED
    const updated = await callStateMachine.transition(
      event.callId,
      CallState.IVR_FAILED,
      {
        reason: failure.message,
        metadata: {
          errors: failure.errors,
        },
      }
    );

    if (updated) {
      // Track metric
      const ivrFailedMetric = METRICS.IVR_FAILED;
      if (ivrFailedMetric) {
        await metrics.increment(ivrFailedMetric);
      }

      // Send notification to patient about the failure
      await notificationService.sendIVRFailed(event.searchId, {
        callId: event.callId,
        pharmacyId: callData.pharmacyId,
        pharmacyName: callData.pharmacyName,
        message: failure.message,
        fallbackMessage: ivrFallback.getFallbackMessage(callData.pharmacyName),
      });

      // Emit internal event
      this.emit('ivrFailed', event);
    }

    // Clean up IVR tracking state
    ivrFallback.cleanup(event.callId);
  }

  /**
   * Handle hold detection (music or message)
   */
  private async handleHoldDetected(event: AIDetectionEvent): Promise<void> {
    eventLogger.info({
      callId: event.callId,
      type: event.detectionType,
    }, 'Hold detected');

    const callData = await callStateMachine.getState(event.callId);
    if (!callData) {
      return;
    }

    // Only transition to HOLD if we're coming from IVR
    if (callData.state === CallState.IVR) {
      await ivrFallback.markSuccess(event.callId, 'on_hold');

      await callStateMachine.transition(
        event.callId,
        CallState.HOLD,
        {
          reason: 'AI detected hold music/message',
        }
      );

      // Notify patient they're on hold
      await notificationService.sendCallStatusUpdate(event.searchId, {
        callId: event.callId,
        pharmacyId: callData.pharmacyId,
        pharmacyName: callData.pharmacyName,
        status: CallState.HOLD,
        previousStatus: CallState.IVR,
        message: `On hold at ${callData.pharmacyName}. Waiting for a pharmacist...`,
      });
    }

    this.emit('holdDetected', event);
  }

  /**
   * Handle hang up detection
   */
  private async handleHangUp(event: AIDetectionEvent): Promise<void> {
    eventLogger.info({
      callId: event.callId,
    }, 'Hang up detected');

    const callData = await callStateMachine.getState(event.callId);
    if (!callData) {
      return;
    }

    await callStateMachine.transition(
      event.callId,
      CallState.ENDED,
      {
        reason: 'Call hung up by other party',
      }
    );

    // Clean up
    ivrFallback.cleanup(event.callId);

    this.emit('callEnded', event);
  }

  /**
   * Handle IVR prompt detection - for logging purposes
   */
  private async handleIVRPrompt(event: AIDetectionEvent): Promise<void> {
    eventLogger.debug({
      callId: event.callId,
      transcript: event.transcript,
    }, 'IVR prompt detected');

    // Record the navigation attempt
    ivrFallback.recordAttempt(event.callId);
  }

  /**
   * Create a detection event from OpenAI function call
   */
  createDetectionEvent(
    callId: string,
    searchId: string,
    functionName: string,
    args: Record<string, unknown>
  ): AIDetectionEvent | null {
    const typeMap: Record<string, DetectionType> = {
      report_human_detected: DetectionType.HUMAN_DETECTED,
      report_voicemail: DetectionType.VOICEMAIL_DETECTED,
      report_ivr_failed: DetectionType.IVR_FAILED,
      report_hold_detected: DetectionType.HOLD_MUSIC,
      report_hang_up: DetectionType.HANG_UP,
      report_ivr_prompt: DetectionType.IVR_PROMPT,
    };

    const detectionType = typeMap[functionName];
    if (!detectionType) {
      return null;
    }

    const event: AIDetectionEvent = {
      callId,
      searchId,
      detectionType,
      confidence: (args.confidence as number) ?? 0.9,
      timestamp: Date.now(),
    };

    // Only set optional properties if they have values
    if (args.transcript) {
      event.transcript = args.transcript as string;
    }
    if (args.context) {
      event.context = args.context as string;
    }

    return event;
  }
}

export const openaiEventHandler = new OpenAIEventHandler();
