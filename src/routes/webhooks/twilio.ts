import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { callStateMachine } from '../../services/callStateMachine.js';
import { CallState } from '../../types/callStates.js';
import { metrics, METRICS } from '../../services/metrics.js';
import { validateTwilioSignature } from '../../middleware/webhookAuth.js';
import { notificationService } from '../../services/notifications.js';
import { pharmacyTracker } from '../../services/pharmacyTracker.js';
import { redis } from '../../services/redis.js';

const webhookLogger = logger.child({ service: 'twilio-webhooks' });

// Twilio sends form data
const VoiceWebhookSchema = z.object({
  CallSid: z.string(),
  CallStatus: z.string(),
  From: z.string(),
  To: z.string(),
  Direction: z.string(),
  AccountSid: z.string(),
  ApiVersion: z.string().optional(),
  Caller: z.string().optional(),
  Called: z.string().optional(),
});

const StatusCallbackSchema = z.object({
  CallSid: z.string(),
  CallStatus: z.enum([
    'queued',
    'initiated',
    'ringing',
    'in-progress',
    'completed',
    'busy',
    'no-answer',
    'canceled',
    'failed',
  ]),
  CallDuration: z.string().optional(),
  From: z.string().optional(),
  To: z.string().optional(),
  Direction: z.string().optional(),
  AccountSid: z.string().optional(),
  Timestamp: z.string().optional(),
  SequenceNumber: z.string().optional(),
});

// Map Twilio call status to our call states
function mapTwilioStatusToCallState(twilioStatus: string): CallState | null {
  switch (twilioStatus) {
    case 'initiated':
    case 'queued':
      return CallState.DIALING;
    case 'ringing':
      return CallState.DIALING;
    case 'in-progress':
      // Direct connection mode: pharmacy answered, mark as connected
      return CallState.CONNECTED;
    case 'completed':
      return CallState.ENDED;
    case 'busy':
    case 'no-answer':
    case 'canceled':
    case 'failed':
      return CallState.FAILED;
    default:
      return null;
  }
}

export async function twilioWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Register content type parser for form-urlencoded
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const parsed: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  /**
   * POST /webhooks/twilio/voice
   * Initial voice webhook - called when Twilio connects a call
   * Returns TwiML to control call behavior
   */
  app.post(
    '/webhooks/twilio/voice',
    {
      preHandler: validateTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = VoiceWebhookSchema.safeParse(request.body);

      if (!parseResult.success) {
        webhookLogger.warn({ errors: parseResult.error.errors }, 'Invalid voice webhook payload');
        return reply.status(400).send({ error: 'Invalid payload' });
      }

      const { CallSid, CallStatus, To, From, Direction } = parseResult.data;

      webhookLogger.info({
        callSid: CallSid,
        status: CallStatus,
        to: To,
        from: From,
        direction: Direction,
      }, 'Voice webhook received');

      // Track metric
      const callCountMetric = METRICS.CALL_COUNT;
      if (callCountMetric) {
        await metrics.increment(callCountMetric);
      }

      // Get the callId from query params (passed when initiating the call)
      const query = request.query as Record<string, string>;
      const callId = query?.callId ?? 'unknown';

      webhookLogger.info({
        callId,
        callSid: CallSid,
        demoMode: env.DEMO_MODE,
        troubleshootMode: env.TROUBLESHOOT_MODE,
      }, 'Processing voice webhook');

      let twiml: string;

      if (env.DEMO_MODE) {
        // Demo mode: put the pharmacy into a conference directly (no AI)
        // The user's browser will join the same conference via the client-voice webhook
        const conferenceName = `call-${callId}`;

        webhookLogger.info({
          callId,
          callSid: CallSid,
          conferenceName,
        }, 'Demo mode: connecting pharmacy to conference');

        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${conferenceName}</Conference>
  </Dial>
</Response>`;
      } else {
        // AI mode: stream audio to our media-stream WebSocket for AI processing
        const webhookBaseUrl = env.WEBHOOK_BASE_URL;

        if (!webhookBaseUrl) {
          webhookLogger.error('WEBHOOK_BASE_URL not configured - cannot stream audio');
          // Fall back to conference mode
          const conferenceName = `call-${callId}`;
          twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${conferenceName}</Conference>
  </Dial>
</Response>`;
        } else {
          // Convert https:// to wss:// for WebSocket
          // Note: callId is passed as a Stream Parameter, not in URL query (Twilio doesn't forward query params)
          const streamUrl = webhookBaseUrl.replace('https://', 'wss://') + '/media-stream';

          webhookLogger.info({
            callId,
            callSid: CallSid,
            streamUrl,
          }, 'AI mode: streaming pharmacy audio to OpenAI');

          if (env.TROUBLESHOOT_MODE) {
            // Troubleshoot mode: enable recording for debugging
            // Use <Start><Stream> + <Record> to do both simultaneously
            const recordingStatusUrl = `${webhookBaseUrl}/webhooks/twilio/recording-status?callId=${callId}`;

            webhookLogger.info({
              callId,
              recordingStatusUrl,
            }, 'Troubleshoot mode: enabling call recording');

            twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${streamUrl}">
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Start>
  <Record
    recordingStatusCallback="${recordingStatusUrl}"
    recordingStatusCallbackEvent="completed"
    recordingStatusCallbackMethod="POST"
    trim="do-not-trim"
    maxLength="600"
  />
  <Pause length="600"/>
</Response>`;
          } else {
            // Normal AI mode: just stream audio
            twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Connect>
</Response>`;
          }
        }
      }

      void reply.type('text/xml');
      return reply.send(twiml);
    }
  );

  /**
   * POST /webhooks/twilio/status
   * Status callback - called when call status changes
   */
  app.post(
    '/webhooks/twilio/status',
    {
      preHandler: validateTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = StatusCallbackSchema.safeParse(request.body);

      if (!parseResult.success) {
        webhookLogger.warn({ errors: parseResult.error.errors }, 'Invalid status callback payload');
        return reply.status(400).send({ error: 'Invalid payload' });
      }

      const { CallSid, CallStatus, CallDuration, To } = parseResult.data;

      webhookLogger.info({
        callSid: CallSid,
        status: CallStatus,
        duration: CallDuration,
        to: To,
      }, 'Status callback received');

      // Find call by Twilio SID and update state
      const callId = await findCallIdByTwilioSid(CallSid);

      if (!callId) {
        webhookLogger.warn({ callSid: CallSid }, 'No call found for Twilio SID');
        return reply.status(200).send({ received: true });
      }

      const callData = await callStateMachine.getState(callId);
      if (!callData) {
        webhookLogger.warn({ callId }, 'Call state not found');
        return reply.status(200).send({ received: true });
      }

      // Map Twilio status to our state
      const newState = mapTwilioStatusToCallState(CallStatus);

      if (newState && callStateMachine.isValidTransition(callData.state, newState)) {
        await callStateMachine.transition(callId, newState, {
          reason: `Twilio status: ${CallStatus}`,
          metadata: {
            twilioCallDuration: CallDuration,
          },
        });

        // Update pharmacy tracker (sends WebSocket notification to frontend)
        await pharmacyTracker.updateFromCallState(callData.searchId, callId, newState);

        // Send notification for state change
        await notificationService.sendCallStatusUpdate(callData.searchId, {
          callId,
          pharmacyId: callData.pharmacyId,
          pharmacyName: callData.pharmacyName,
          status: newState,
          previousStatus: callData.state,
        });

        // Track metrics for terminal states
        if (CallStatus === 'completed') {
          const successMetric = METRICS.CALL_SUCCESS;
          if (successMetric) {
            await metrics.increment(successMetric);
          }
        } else if (['busy', 'no-answer', 'canceled', 'failed'].includes(CallStatus)) {
          const failedMetric = METRICS.CALL_FAILED;
          if (failedMetric) {
            await metrics.increment(failedMetric);
          }
        }
      }

      // Always respond 200 to Twilio
      return reply.status(200).send({ received: true });
    }
  );

  /**
   * POST /webhooks/twilio/gather
   * Gather callback - called when DTMF input is received
   */
  app.post(
    '/webhooks/twilio/gather',
    {
      preHandler: validateTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const digits = body?.Digits ?? '';
      const callSid = body?.CallSid ?? '';

      webhookLogger.info({
        callSid,
        digits,
      }, 'Gather callback received');

      // This would be used if we need DTMF fallback for IVR navigation
      // For now, return empty TwiML to continue

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`;

      void reply.type('text/xml');
      return reply.send(twiml);
    }
  );

  /**
   * POST /webhooks/twilio/fallback
   * Fallback webhook - called when primary webhook fails
   */
  app.post(
    '/webhooks/twilio/fallback',
    {
      preHandler: validateTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const callSid = body?.CallSid ?? '';
      const errorCode = body?.ErrorCode ?? '';
      const errorMessage = body?.ErrorMessage ?? '';

      webhookLogger.error({
        callSid,
        errorCode,
        errorMessage,
      }, 'Fallback webhook triggered - primary webhook failed');

      // Track error metric
      const webhookErrorMetric = METRICS.WEBHOOK_ERRORS;
      if (webhookErrorMetric) {
        await metrics.increment(webhookErrorMetric);
      }

      // Return TwiML to gracefully end the call
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, but we're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`;

      void reply.type('text/xml');
      return reply.send(twiml);
    }
  );
  /**
   * POST /webhooks/twilio/client-voice
   * Called by Twilio when a browser client (Device.connect) initiates a call.
   * The TwiML App's voice URL should point to this endpoint.
   * Returns TwiML to join the user to the pharmacy's conference.
   */
  app.post(
    '/webhooks/twilio/client-voice',
    {
      preHandler: validateTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const to = body?.To ?? '';
      const callSid = body?.CallSid ?? '';

      webhookLogger.info({
        callSid,
        to,
      }, 'Client voice webhook received');

      // The frontend passes the conference name as the "To" parameter
      // Format: "call-{callId}"
      const conferenceName = to;

      if (!conferenceName || !conferenceName.startsWith('call-')) {
        webhookLogger.warn({ to }, 'Invalid conference name from client');
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Invalid call configuration.</Say>
  <Hangup/>
</Response>`;
        void reply.type('text/xml');
        return reply.send(twiml);
      }

      webhookLogger.info({
        conferenceName,
        callSid,
      }, 'Joining user to pharmacy conference');

      // Join the user to the same conference as the pharmacy
      // endConferenceOnExit=true: when user hangs up, end the conference (and pharmacy call)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">${conferenceName}</Conference>
  </Dial>
</Response>`;

      void reply.type('text/xml');
      return reply.send(twiml);
    }
  );

  /**
   * POST /webhooks/twilio/recording-status
   * Recording status callback - called when call recording completes
   * (Only used in troubleshoot mode)
   */
  app.post(
    '/webhooks/twilio/recording-status',
    {
      preHandler: validateTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const query = request.query as Record<string, string>;
      const callId = query?.callId;
      const recordingUrl = body?.RecordingUrl;
      const recordingSid = body?.RecordingSid;
      const recordingDuration = body?.RecordingDuration;
      const recordingStatus = body?.RecordingStatus;

      webhookLogger.info({
        callId,
        recordingUrl,
        recordingSid,
        recordingDuration,
        recordingStatus,
      }, 'Recording status callback received');

      if (callId && recordingUrl && recordingStatus === 'completed') {
        // Store recording URL in Redis for later retrieval (24 hour TTL)
        const recordingData = JSON.stringify({
          url: recordingUrl + '.mp3', // Add .mp3 for browser playback
          sid: recordingSid,
          duration: recordingDuration,
          createdAt: Date.now(),
        });

        await redis.set(`recording:${callId}`, recordingData, 'EX', 86400);

        webhookLogger.info({
          callId,
          recordingSid,
        }, 'Recording stored for troubleshoot mode');
      }

      return reply.status(204).send();
    }
  );
}

/**
 * Finds the internal call ID by Twilio CallSid
 * This requires a reverse lookup from Redis or database
 */
async function findCallIdByTwilioSid(twilioSid: string): Promise<string | null> {
  // We store a mapping when we initiate calls
  const { redis } = await import('../../services/redis.js');
  const callId = await redis.get(`twilio:sid:${twilioSid}`);
  return callId;
}

/**
 * Stores the mapping between Twilio SID and internal call ID
 */
export async function mapTwilioSidToCallId(twilioSid: string, callId: string): Promise<void> {
  const { redis } = await import('../../services/redis.js');
  // Store with 24 hour TTL
  await redis.set(`twilio:sid:${twilioSid}`, callId, 'EX', 86400);

  webhookLogger.debug({
    twilioSid,
    callId,
  }, 'Mapped Twilio SID to call ID');
}
