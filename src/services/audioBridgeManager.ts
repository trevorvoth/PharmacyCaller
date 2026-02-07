import type { WebSocket } from 'ws';
import { AudioBridge } from './audioBridge.js';
import { callStateMachine } from './callStateMachine.js';
import { pharmacyTracker } from './pharmacyTracker.js';
import { notificationService } from './notifications.js';
import { twilioClient } from './twilio/client.js';
import { generateConferenceJoinTwiml } from './twilio/calls.js';
import { ivrRouter } from './openai/ivrRouter.js';
import { getPharmacyIVRPrompt } from './openai/prompts.js';
import { logger } from '../utils/logger.js';
import { CallState, type CallStateData } from '../types/callStates.js';

const bridgeLogger = logger.child({ service: 'audio-bridge-manager' });

// Active bridges indexed by callId
const activeBridges = new Map<string, AudioBridge>();

// Track which search each call belongs to (for cleanup)
const callToSearchMap = new Map<string, string>();

export interface MediaStreamMetadata {
  callSid?: string;
  streamSid?: string;
}

export const audioBridgeManager = {
  /**
   * Handle a new media stream connection from Twilio
   * Called when Twilio connects to our /media-stream WebSocket endpoint
   */
  async handleConnection(callId: string, ws: WebSocket, metadata?: MediaStreamMetadata): Promise<void> {
    const callState = await callStateMachine.getState(callId);
    if (!callState) {
      bridgeLogger.warn({ callId }, 'Media stream connection for unknown call');
      ws.close(1008, 'Unknown call');
      return;
    }

    bridgeLogger.info({
      callId,
      searchId: callState.searchId,
      pharmacyName: callState.pharmacyName,
      callSid: metadata?.callSid,
      streamSid: metadata?.streamSid,
    }, 'Media stream connected - setting up AudioBridge');

    // Track call-to-search mapping for cleanup
    callToSearchMap.set(callId, callState.searchId);

    // Detect pharmacy chain for chain-specific IVR navigation
    const chain = ivrRouter.detectChain(callState.pharmacyName, callState.phoneNumber);

    // Get medication query from metadata if available
    const medicationQuery = callState.metadata?.medicationQuery as string | undefined;

    // Generate AI instructions for IVR navigation
    const instructions = getPharmacyIVRPrompt({
      pharmacyName: callState.pharmacyName,
      pharmacyChain: chain ?? undefined,
      medicationQuery,
    });

    bridgeLogger.debug({
      callId,
      chain,
      hasInstructions: !!instructions,
    }, 'Generated IVR instructions for AI');

    // Create new AudioBridge instance
    const bridge = new AudioBridge();
    activeBridges.set(callId, bridge);

    // Wire up event handlers
    bridge.on('humanDetected', () => {
      void this.onHumanDetected(callId, callState);
    });

    bridge.on('voicemailDetected', () => {
      void this.onVoicemailDetected(callId);
    });

    bridge.on('ivrFailed', () => {
      void this.onIvrFailed(callId);
    });

    bridge.on('holdDetected', () => {
      void this.onHoldDetected(callId);
    });

    bridge.on('transcript', (text: string, speaker: 'ai' | 'pharmacy') => {
      bridgeLogger.debug({ callId, speaker, text }, 'Transcript received');

      // Check for hold state from pharmacy audio
      if (speaker === 'pharmacy' && ivrRouter.isOnHold(text, chain)) {
        void this.onHoldDetected(callId);
      }
    });

    bridge.on('disconnected', () => {
      bridgeLogger.info({ callId }, 'AudioBridge disconnected');
      this.cleanup(callId);
    });

    bridge.on('error', (error: Error) => {
      bridgeLogger.error({ callId, err: error }, 'AudioBridge error');
      this.cleanup(callId);
    });

    try {
      // Connect the bridge (Twilio WS + OpenAI)
      await bridge.connect(ws, {
        sessionConfig: {
          instructions,
          voice: 'alloy',
          inputAudioFormat: 'g711_ulaw',
          outputAudioFormat: 'g711_ulaw',
          turnDetection: {
            type: 'server_vad',
            threshold: 0.6,
            prefixPaddingMs: 500,
            silenceDurationMs: 1500,
          },
        },
      });

      // Transition call state to IVR (AI is now navigating)
      await callStateMachine.transition(callId, CallState.IVR, {
        reason: 'Media stream connected, AI navigation started',
      });

      // Update tracker
      await pharmacyTracker.updateFromCallState(callState.searchId, callId, CallState.IVR);

      bridgeLogger.info({ callId }, 'AudioBridge connected and IVR navigation started');
    } catch (error) {
      bridgeLogger.error({ callId, err: error }, 'Failed to connect AudioBridge');
      this.cleanup(callId);
      ws.close(1011, 'Failed to connect');
    }
  },

  /**
   * Handle human pharmacist detection
   * Disconnect AI, transition call to conference, notify patient
   */
  async onHumanDetected(callId: string, callState: CallStateData): Promise<void> {
    bridgeLogger.info({
      callId,
      pharmacyName: callState.pharmacyName,
    }, 'Human detected - transitioning to conference');

    // Get current state to ensure we have twilioCallSid
    const currentState = await callStateMachine.getState(callId);
    const twilioCallSid = currentState?.twilioCallSid ?? callState.twilioCallSid;

    if (!twilioCallSid) {
      bridgeLogger.error({ callId }, 'No Twilio call SID for conference transition');
      return;
    }

    // Disconnect AI bridge immediately
    const bridge = activeBridges.get(callId);
    if (bridge) {
      bridge.disconnect();
      activeBridges.delete(callId);
    }

    // Generate conference name for this call
    const conferenceName = `call-${callId}`;

    try {
      // Update the Twilio call to join a conference instead of streaming
      // This allows the patient to join the same conference
      const twiml = generateConferenceJoinTwiml(conferenceName, {
        startOnEnter: true,
        endOnExit: false,
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock',
      });

      await twilioClient.calls(twilioCallSid).update({ twiml });

      bridgeLogger.info({
        callId,
        twilioCallSid,
        conferenceName,
      }, 'Call transitioned to conference');
    } catch (error) {
      bridgeLogger.error({
        callId,
        twilioCallSid,
        err: error,
      }, 'Failed to transition call to conference');
      return;
    }

    // Update state machine
    await callStateMachine.transition(callId, CallState.HUMAN_DETECTED, {
      conferenceName,
      reason: 'Human pharmacist detected by AI',
    });

    // Update tracker
    await pharmacyTracker.updateFromCallState(callState.searchId, callId, CallState.HUMAN_DETECTED);

    // Notify patient (triggers overlay with Answer button)
    await notificationService.sendCallConnect(callState.searchId, {
      searchId: callState.searchId,
      callId,
      pharmacyId: callState.pharmacyId,
      pharmacyName: callState.pharmacyName,
      conferenceName,
    });

    bridgeLogger.info({
      callId,
      searchId: callState.searchId,
      pharmacyName: callState.pharmacyName,
    }, 'Patient notified - ready for connection');
  },

  /**
   * Handle voicemail detection
   * End the call and move to next pharmacy
   */
  async onVoicemailDetected(callId: string): Promise<void> {
    bridgeLogger.info({ callId }, 'Voicemail detected - ending call');

    const callState = await callStateMachine.getState(callId);
    if (!callState) {
      return;
    }

    // Cleanup bridge
    this.cleanup(callId);

    // End the Twilio call
    if (callState.twilioCallSid) {
      try {
        await twilioClient.calls(callState.twilioCallSid).update({
          status: 'completed',
        });
      } catch (error) {
        bridgeLogger.error({ callId, err: error }, 'Failed to end Twilio call');
      }
    }

    // Transition state
    await callStateMachine.transition(callId, CallState.VOICEMAIL, {
      reason: 'Voicemail detected by AI',
    });

    // Update tracker (this will trigger startNextCall for the next pharmacy)
    await pharmacyTracker.updateFromCallState(callState.searchId, callId, CallState.VOICEMAIL);
  },

  /**
   * Handle IVR navigation failure
   * End the call and move to next pharmacy
   */
  async onIvrFailed(callId: string): Promise<void> {
    bridgeLogger.info({ callId }, 'IVR navigation failed - ending call');

    const callState = await callStateMachine.getState(callId);
    if (!callState) {
      return;
    }

    // Cleanup bridge
    this.cleanup(callId);

    // End the Twilio call
    if (callState.twilioCallSid) {
      try {
        await twilioClient.calls(callState.twilioCallSid).update({
          status: 'completed',
        });
      } catch (error) {
        bridgeLogger.error({ callId, err: error }, 'Failed to end Twilio call');
      }
    }

    // Transition state
    await callStateMachine.transition(callId, CallState.IVR_FAILED, {
      reason: 'AI failed to navigate IVR after multiple attempts',
    });

    // Update tracker (this will trigger startNextCall for the next pharmacy)
    await pharmacyTracker.updateFromCallState(callState.searchId, callId, CallState.IVR_FAILED);

    // Send IVR failed notification
    await notificationService.sendIVRFailed(callState.searchId, {
      callId,
      pharmacyId: callState.pharmacyId,
      pharmacyName: callState.pharmacyName,
      message: 'Unable to navigate phone system',
      fallbackMessage: 'Moving to next pharmacy...',
    });
  },

  /**
   * Handle hold state detection
   * Update state to show we're waiting for a human
   */
  async onHoldDetected(callId: string): Promise<void> {
    const callState = await callStateMachine.getState(callId);
    if (!callState) {
      return;
    }

    // Only transition if we're in IVR state (not already on hold)
    if (callState.state !== CallState.IVR) {
      return;
    }

    bridgeLogger.info({ callId, pharmacyName: callState.pharmacyName }, 'Hold detected');

    // Transition to HOLD state
    await callStateMachine.transition(callId, CallState.HOLD, {
      reason: 'Placed on hold, waiting for pharmacist',
    });

    // Update tracker
    await pharmacyTracker.updateFromCallState(callState.searchId, callId, CallState.HOLD);
  },

  /**
   * Cleanup a single call's bridge
   */
  cleanup(callId: string): void {
    const bridge = activeBridges.get(callId);
    if (bridge) {
      try {
        bridge.disconnect();
      } catch (error) {
        bridgeLogger.error({ callId, err: error }, 'Error disconnecting bridge');
      }
      activeBridges.delete(callId);
    }
    callToSearchMap.delete(callId);
  },

  /**
   * Cleanup all bridges for a search (when search is cancelled)
   */
  cleanupSearch(searchId: string): void {
    bridgeLogger.info({ searchId }, 'Cleaning up all bridges for search');

    let cleanedCount = 0;
    for (const [callId, mappedSearchId] of callToSearchMap) {
      if (mappedSearchId === searchId) {
        this.cleanup(callId);
        cleanedCount++;
      }
    }

    bridgeLogger.info({ searchId, cleanedCount }, 'Search bridges cleaned up');
  },

  /**
   * Get active bridge count (for debugging/metrics)
   */
  getActiveBridgeCount(): number {
    return activeBridges.size;
  },

  /**
   * Check if a call has an active bridge
   */
  hasActiveBridge(callId: string): boolean {
    return activeBridges.has(callId);
  },
};
