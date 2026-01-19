import { twilioClient } from './client.js';
import { twilioConfig } from '../../config/twilio.js';
import { logger } from '../../utils/logger.js';
import type { CallInstance } from 'twilio/lib/rest/api/v2010/account/call.js';

const callLogger = logger.child({ service: 'twilio-calls' });

export interface InitiateCallParams {
  to: string;
  webhookUrl: string;
  statusCallbackUrl: string;
  callerId?: string;
  timeout?: number;
  machineDetection?: 'Enable' | 'DetectMessageEnd';
}

export interface CallResult {
  callSid: string;
  status: string;
  to: string;
  from: string;
}

export async function initiateCall(params: InitiateCallParams): Promise<CallResult> {
  const {
    to,
    webhookUrl,
    statusCallbackUrl,
    callerId = twilioConfig.phoneNumber,
    timeout = 30,
    machineDetection,
  } = params;

  callLogger.info({ to, webhookUrl }, 'Initiating outbound call');

  try {
    const call = await twilioClient.calls.create({
      to,
      from: callerId,
      url: webhookUrl,
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      timeout,
      machineDetection,
    });

    callLogger.info({
      callSid: call.sid,
      to: call.to,
      status: call.status,
    }, 'Call initiated successfully');

    return {
      callSid: call.sid,
      status: call.status,
      to: call.to,
      from: call.from,
    };
  } catch (error) {
    callLogger.error({ err: error, to }, 'Failed to initiate call');
    throw error;
  }
}

export async function getCallStatus(callSid: string): Promise<CallInstance> {
  return twilioClient.calls(callSid).fetch();
}

export async function endCall(callSid: string): Promise<void> {
  callLogger.info({ callSid }, 'Ending call');

  try {
    await twilioClient.calls(callSid).update({
      status: 'completed',
    });

    callLogger.info({ callSid }, 'Call ended successfully');
  } catch (error) {
    callLogger.error({ err: error, callSid }, 'Failed to end call');
    throw error;
  }
}

export async function updateCallTwiml(callSid: string, twimlUrl: string): Promise<void> {
  await twilioClient.calls(callSid).update({
    url: twimlUrl,
    method: 'POST',
  });
}

export function generateTwimlResponse(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${content}
</Response>`;
}

export function generateMediaStreamTwiml(
  streamUrl: string,
  streamName: string
): string {
  return generateTwimlResponse(`
  <Connect>
    <Stream url="${streamUrl}" name="${streamName}">
      <Parameter name="callSid" value="{{CallSid}}" />
    </Stream>
  </Connect>
`);
}

export function generateConferenceJoinTwiml(
  conferenceName: string,
  options: {
    startOnEnter?: boolean;
    endOnExit?: boolean;
    muted?: boolean;
    waitUrl?: string;
    statusCallback?: string;
  } = {}
): string {
  const {
    startOnEnter = true,
    endOnExit = false,
    muted = false,
    waitUrl = 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
    statusCallback,
  } = options;

  const statusCallbackAttr = statusCallback
    ? `statusCallback="${statusCallback}" statusCallbackEvent="start end join leave"`
    : '';

  return generateTwimlResponse(`
  <Dial>
    <Conference
      startConferenceOnEnter="${startOnEnter}"
      endConferenceOnExit="${endOnExit}"
      muted="${muted}"
      waitUrl="${waitUrl}"
      ${statusCallbackAttr}
    >${conferenceName}</Conference>
  </Dial>
`);
}

export function generateSayTwiml(message: string, voice = 'alice'): string {
  return generateTwimlResponse(`
  <Say voice="${voice}">${message}</Say>
`);
}
