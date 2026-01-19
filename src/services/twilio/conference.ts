import { twilioClient } from './client.js';
import { logger } from '../../utils/logger.js';

const conferenceLogger = logger.child({ service: 'twilio-conference' });

export interface ConferenceInfo {
  conferenceSid: string;
  friendlyName: string;
  status: string;
  participantCount: number;
}

export interface ParticipantInfo {
  callSid: string;
  conferenceSid: string;
  muted: boolean;
  hold: boolean;
  status: string;
}

export async function getConferenceByName(
  friendlyName: string
): Promise<ConferenceInfo | null> {
  try {
    const conferences = await twilioClient.conferences.list({
      friendlyName,
      status: 'in-progress',
      limit: 1,
    });

    if (conferences.length === 0) {
      return null;
    }

    const conf = conferences[0];
    if (!conf) {
      return null;
    }

    const participants = await twilioClient
      .conferences(conf.sid)
      .participants.list();

    return {
      conferenceSid: conf.sid,
      friendlyName: conf.friendlyName,
      status: conf.status,
      participantCount: participants.length,
    };
  } catch (error) {
    conferenceLogger.error({ err: error, friendlyName }, 'Failed to get conference');
    return null;
  }
}

export async function addParticipantToConference(
  conferenceSid: string,
  callSid: string
): Promise<ParticipantInfo> {
  conferenceLogger.info({ conferenceSid, callSid }, 'Adding participant to conference');

  try {
    // Update the call to join the conference
    await twilioClient.calls(callSid).update({
      twiml: `<Response><Dial><Conference>${conferenceSid}</Conference></Dial></Response>`,
    });

    // Get participant info
    const participant = await twilioClient
      .conferences(conferenceSid)
      .participants(callSid)
      .fetch();

    conferenceLogger.info({
      conferenceSid,
      callSid,
      muted: participant.muted,
    }, 'Participant added to conference');

    return {
      callSid: participant.callSid,
      conferenceSid: participant.conferenceSid,
      muted: participant.muted,
      hold: participant.hold,
      status: 'connected',
    };
  } catch (error) {
    conferenceLogger.error({ err: error, conferenceSid, callSid }, 'Failed to add participant');
    throw error;
  }
}

export async function removeParticipantFromConference(
  conferenceSid: string,
  callSid: string
): Promise<void> {
  conferenceLogger.info({ conferenceSid, callSid }, 'Removing participant from conference');

  try {
    await twilioClient
      .conferences(conferenceSid)
      .participants(callSid)
      .remove();

    conferenceLogger.info({ conferenceSid, callSid }, 'Participant removed from conference');
  } catch (error) {
    conferenceLogger.error({ err: error, conferenceSid, callSid }, 'Failed to remove participant');
    throw error;
  }
}

export async function muteParticipant(
  conferenceSid: string,
  callSid: string,
  muted: boolean
): Promise<void> {
  await twilioClient
    .conferences(conferenceSid)
    .participants(callSid)
    .update({ muted });
}

export async function holdParticipant(
  conferenceSid: string,
  callSid: string,
  hold: boolean,
  holdUrl?: string
): Promise<void> {
  await twilioClient
    .conferences(conferenceSid)
    .participants(callSid)
    .update({
      hold,
      holdUrl,
    });
}

export async function endConference(conferenceSid: string): Promise<void> {
  conferenceLogger.info({ conferenceSid }, 'Ending conference');

  try {
    await twilioClient.conferences(conferenceSid).update({
      status: 'completed',
    });

    conferenceLogger.info({ conferenceSid }, 'Conference ended');
  } catch (error) {
    conferenceLogger.error({ err: error, conferenceSid }, 'Failed to end conference');
    throw error;
  }
}

export async function getConferenceParticipants(
  conferenceSid: string
): Promise<ParticipantInfo[]> {
  const participants = await twilioClient
    .conferences(conferenceSid)
    .participants.list();

  return participants.map((p) => ({
    callSid: p.callSid,
    conferenceSid: p.conferenceSid,
    muted: p.muted,
    hold: p.hold,
    status: 'connected',
  }));
}

export function generateConferenceName(searchId: string, pharmacyId: string): string {
  return `pharmacy-${searchId}-${pharmacyId}`;
}
