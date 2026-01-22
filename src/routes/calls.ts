import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { callStateMachine } from '../services/callStateMachine.js';
import { callQueue } from '../services/callQueue.js';
import { pharmacyTracker } from '../services/pharmacyTracker.js';
import { patientTimeout } from '../services/patientTimeout.js';
import { addParticipantToConference, getConferenceByName } from '../services/twilio/conference.js';
import { CallState } from '../types/callStates.js';
import { twilioClient } from '../services/twilio/client.js';
import { env } from '../config/env.js';

const callLogger = logger.child({ service: 'calls-routes' });

export async function callRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /calls/:id/join
   * Task 6.6: Join a call (bridge patient to pharmacist)
   */
  app.post(
    '/calls/:id/join',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id: callId } = (request.params as { id: string });

      callLogger.info({
        callId,
        userId: user.userId,
      }, 'Patient requesting to join call');

      // Get call state
      const callData = await callStateMachine.getState(callId);

      if (!callData) {
        return reply.status(404).send({ error: 'Call not found' });
      }

      // Verify user owns this search
      const search = await prisma.pharmacySearch.findUnique({
        where: { id: callData.searchId },
      });

      if (!search || search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Check call state - must be HUMAN_DETECTED or VOICEMAIL
      if (![CallState.HUMAN_DETECTED, CallState.VOICEMAIL].includes(callData.state)) {
        return reply.status(400).send({
          error: 'Call not ready',
          message: `This call is in ${callData.state} state. Cannot join yet.`,
        });
      }

      // In demo mode, we don't need a real Twilio session
      if (!env.DEMO_MODE && !callData.twilioCallSid) {
        return reply.status(400).send({
          error: 'Call not available',
          message: 'This call does not have an active Twilio session.',
        });
      }

      try {
        // Transition to BRIDGING
        await callStateMachine.transition(callId, CallState.BRIDGING, {
          reason: 'Patient joining call',
        });

        const conferenceName = callData.conferenceName ?? `conf-${callData.searchId}-${callId}`;

        // In demo mode, skip Twilio conference setup
        if (env.DEMO_MODE) {
          // Update call state to CONNECTED
          await callStateMachine.transition(callId, CallState.CONNECTED, {
            reason: 'Patient connected (demo mode)',
            conferenceName,
          });

          // Mark in queue as connected
          await callQueue.setConnectedCall(callData.searchId, {
            callId,
            searchId: callData.searchId,
            pharmacyName: callData.pharmacyName,
            connectedAt: Date.now(),
            patientCallSid: null,
          });

          // End other calls that have humans waiting
          await callQueue.endOtherCallsOnJoin(callData.searchId, callId);

          // Cancel any pending timeout
          await patientTimeout.acknowledge(callData.searchId, callId);

          // Update tracker
          await pharmacyTracker.updateFromCallState(callData.searchId, callId, CallState.CONNECTED);

          callLogger.info({
            callId,
            conferenceName,
            pharmacyName: callData.pharmacyName,
            demoMode: true,
          }, 'Patient joined call successfully (demo mode)');

          return reply.send({
            success: true,
            conferenceName,
            conferenceSid: `demo-${callId}`,
            pharmacyName: callData.pharmacyName,
            message: `Connected to ${callData.pharmacyName}`,
            demoMode: true,
          });
        }

        // Real Twilio mode
        let conference = await getConferenceByName(conferenceName);

        // If no conference exists, the pharmacy call needs to be moved to one
        if (!conference) {
          // Update the pharmacy call to join a conference
          await twilioClient.calls(callData.twilioCallSid!).update({
            twiml: `<Response><Dial><Conference>${conferenceName}</Conference></Dial></Response>`,
          });

          // Wait a moment for conference to be created
          await new Promise((resolve) => setTimeout(resolve, 1000));
          conference = await getConferenceByName(conferenceName);
        }

        if (!conference) {
          throw new Error('Failed to create conference');
        }

        // Update call state to CONNECTED
        await callStateMachine.transition(callId, CallState.CONNECTED, {
          reason: 'Patient connected',
          conferenceName,
        });

        // Mark in queue as connected
        await callQueue.setConnectedCall(callData.searchId, {
          callId,
          searchId: callData.searchId,
          pharmacyName: callData.pharmacyName,
          connectedAt: Date.now(),
          patientCallSid: null, // Will be set when patient's WebRTC connects
        });

        // End other calls that have humans waiting
        await callQueue.endOtherCallsOnJoin(callData.searchId, callId);

        // Cancel any pending timeout
        await patientTimeout.acknowledge(callData.searchId, callId);

        // Update tracker
        await pharmacyTracker.updateFromCallState(callData.searchId, callId, CallState.CONNECTED);

        callLogger.info({
          callId,
          conferenceName,
          pharmacyName: callData.pharmacyName,
        }, 'Patient joined call successfully');

        return reply.send({
          success: true,
          conferenceName,
          conferenceSid: conference.conferenceSid,
          pharmacyName: callData.pharmacyName,
          message: `Connected to ${callData.pharmacyName}`,
        });
      } catch (error) {
        callLogger.error({
          err: error,
          callId,
        }, 'Failed to join call');

        // Revert state
        await callStateMachine.transition(callId, CallState.HUMAN_DETECTED, {
          reason: 'Join failed - reverted',
        });

        return reply.status(500).send({
          error: 'Failed to join call',
          message: 'An error occurred while connecting you. Please try again.',
        });
      }
    }
  );

  /**
   * POST /calls/:id/end
   * Task 6.7: End a call
   */
  app.post(
    '/calls/:id/end',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id: callId } = (request.params as { id: string });

      const callData = await callStateMachine.getState(callId);

      if (!callData) {
        return reply.status(404).send({ error: 'Call not found' });
      }

      // Verify user owns this search
      const search = await prisma.pharmacySearch.findUnique({
        where: { id: callData.searchId },
      });

      if (!search || search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      callLogger.info({
        callId,
        userId: user.userId,
        currentState: callData.state,
      }, 'Patient ending call');

      try {
        if (callData.twilioCallSid) {
          // If we were connected to a human, end politely
          if ([CallState.CONNECTED, CallState.BRIDGING, CallState.HUMAN_DETECTED].includes(callData.state)) {
            await callQueue.endCallPolitely(callId, callData.twilioCallSid);
          } else {
            // Just end the call
            await twilioClient.calls(callData.twilioCallSid).update({
              status: 'completed',
            });
          }
        }

        // Transition to ENDED
        await callStateMachine.transition(callId, CallState.ENDED, {
          reason: 'Patient ended call',
        });

        // Clear connected call if this was the active one
        const connected = await callQueue.getConnectedCall(callData.searchId);
        if (connected?.callId === callId) {
          await callQueue.clearConnectedCall(callData.searchId);
        }

        // Update tracker
        await pharmacyTracker.updateFromCallState(callData.searchId, callId, CallState.ENDED);

        return reply.send({
          success: true,
          message: 'Call ended',
        });
      } catch (error) {
        callLogger.error({
          err: error,
          callId,
        }, 'Error ending call');

        return reply.status(500).send({
          error: 'Failed to end call',
          message: 'An error occurred while ending the call.',
        });
      }
    }
  );

  /**
   * POST /calls/:id/ack
   * Task 6.9: Acknowledge a notification (pharmacist ready)
   */
  app.post(
    '/calls/:id/ack',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id: callId } = (request.params as { id: string });

      const callData = await callStateMachine.getState(callId);

      if (!callData) {
        return reply.status(404).send({ error: 'Call not found' });
      }

      // Verify user owns this search
      const search = await prisma.pharmacySearch.findUnique({
        where: { id: callData.searchId },
      });

      if (!search || search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      callLogger.info({
        callId,
        userId: user.userId,
        searchId: callData.searchId,
      }, 'Patient acknowledged notification');

      // Mark as acknowledged in queue
      await callQueue.markAcknowledged(callData.searchId, callId);

      // Cancel the timeout since patient responded
      await patientTimeout.acknowledge(callData.searchId, callId);

      return reply.send({
        success: true,
        message: 'Acknowledged',
        callId,
        pharmacyName: callData.pharmacyName,
      });
    }
  );

  /**
   * GET /calls/:id
   * Get call status
   */
  app.get(
    '/calls/:id',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id: callId } = (request.params as { id: string });

      const callData = await callStateMachine.getState(callId);

      if (!callData) {
        return reply.status(404).send({ error: 'Call not found' });
      }

      // Verify user owns this search
      const search = await prisma.pharmacySearch.findUnique({
        where: { id: callData.searchId },
      });

      if (!search || search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Get queue info
      const queue = await callQueue.getQueue(callData.searchId);
      const queuedCall = queue.find((q) => q.callId === callId);

      return reply.send({
        callId,
        searchId: callData.searchId,
        pharmacyId: callData.pharmacyId,
        pharmacyName: callData.pharmacyName,
        phoneNumber: callData.phoneNumber,
        state: callData.state,
        previousState: callData.previousState,
        stateChangedAt: callData.stateChangedAt,
        createdAt: callData.createdAt,
        isQueued: !!queuedCall,
        queuedAt: queuedCall?.queuedAt,
        notifiedAt: queuedCall?.notifiedAt,
        acknowledgedAt: queuedCall?.acknowledgedAt,
      });
    }
  );

  /**
   * POST /calls/:id/mute
   * Mute/unmute patient in call
   */
  app.post(
    '/calls/:id/mute',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id: callId } = (request.params as { id: string });
      const { muted } = request.body as { muted: boolean };

      const callData = await callStateMachine.getState(callId);

      if (!callData) {
        return reply.status(404).send({ error: 'Call not found' });
      }

      // Verify user owns this search
      const search = await prisma.pharmacySearch.findUnique({
        where: { id: callData.searchId },
      });

      if (!search || search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (callData.state !== CallState.CONNECTED) {
        return reply.status(400).send({
          error: 'Not in call',
          message: 'You must be connected to a call to mute/unmute.',
        });
      }

      // Muting is handled client-side by the Twilio SDK
      // This endpoint is for logging/state tracking
      callLogger.debug({
        callId,
        muted,
      }, 'Patient mute state changed');

      return reply.send({
        success: true,
        muted,
      });
    }
  );
}
