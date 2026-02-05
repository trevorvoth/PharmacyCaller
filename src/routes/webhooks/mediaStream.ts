import type { SocketStream } from '@fastify/websocket';
import type { FastifyRequest } from 'fastify';
import { logger } from '../../utils/logger.js';

const mediaStreamLogger = logger.child({ service: 'media-stream-webhook' });

interface TwilioStreamMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters?: Record<string, string>;
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
}

/**
 * WebSocket handler for Twilio media streams
 *
 * When Twilio calls a pharmacy and the TwiML contains <Connect><Stream>,
 * Twilio will connect to this WebSocket endpoint and stream the call audio.
 * We bridge this audio to OpenAI Realtime API for AI-powered IVR navigation.
 *
 * Note: Twilio doesn't forward URL query parameters to WebSocket connections.
 * Instead, we pass callId as a Stream Parameter in the TwiML, and Twilio
 * delivers it in the 'start' message's customParameters.
 */
export async function handleMediaStream(
  connection: SocketStream,
  _request: FastifyRequest
): Promise<void> {
  mediaStreamLogger.info('Media stream WebSocket connection opened, waiting for start message');

  // We need to wait for Twilio's 'start' message to get the callId
  // Set up a one-time message handler to extract it
  const startTimeout = setTimeout(() => {
    mediaStreamLogger.warn('Timeout waiting for Twilio start message');
    connection.socket.close(1008, 'Timeout waiting for start message');
  }, 10000);

  const handleStartMessage = async (data: Buffer | string) => {
    try {
      const message: TwilioStreamMessage = JSON.parse(data.toString());

      if (message.event === 'start') {
        clearTimeout(startTimeout);

        const callId = message.start?.customParameters?.callId;
        const callSid = message.start?.callSid;
        const streamSid = message.start?.streamSid;

        mediaStreamLogger.info({
          callId,
          callSid,
          streamSid,
          customParameters: message.start?.customParameters,
        }, 'Received Twilio start message');

        if (!callId) {
          mediaStreamLogger.error({ customParameters: message.start?.customParameters }, 'No callId in start message customParameters');
          connection.socket.close(1008, 'Missing callId in start message');
          return;
        }

        // Remove this temporary handler
        connection.socket.off('message', handleStartMessage);

        // Import audioBridgeManager dynamically to avoid circular dependencies
        const { audioBridgeManager } = await import('../../services/audioBridgeManager.js');

        try {
          await audioBridgeManager.handleConnection(callId, connection.socket, {
            callSid,
            streamSid,
          });
        } catch (error) {
          mediaStreamLogger.error({ callId, err: error }, 'Failed to handle media stream connection');
          connection.socket.close(1011, 'Internal error');
        }
      }
    } catch (error) {
      mediaStreamLogger.error({ err: error }, 'Failed to parse WebSocket message');
    }
  };

  connection.socket.on('message', handleStartMessage);
}
