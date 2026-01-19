import Twilio from 'twilio';
import { twilioConfig } from '../../config/twilio.js';
import { logger } from '../../utils/logger.js';

const twilioLogger = logger.child({ service: 'twilio' });

// Create Twilio client
export const twilioClient = Twilio(
  twilioConfig.accountSid,
  twilioConfig.authToken
);

// Verify credentials on startup
export async function verifyTwilioCredentials(): Promise<boolean> {
  try {
    const account = await twilioClient.api.accounts(twilioConfig.accountSid).fetch();
    twilioLogger.info({
      accountSid: account.sid,
      friendlyName: account.friendlyName,
      status: account.status,
    }, 'Twilio credentials verified');
    return true;
  } catch (error) {
    twilioLogger.error({ err: error }, 'Failed to verify Twilio credentials');
    return false;
  }
}

// Generate capability token for client SDK
export function generateAccessToken(identity: string): string {
  const { AccessToken } = Twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(
    twilioConfig.accountSid,
    twilioConfig.apiKeySid ?? twilioConfig.accountSid,
    twilioConfig.apiKeySecret ?? twilioConfig.authToken,
    { identity }
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: undefined, // We'll add TwiML app later
    incomingAllow: true,
  });

  token.addGrant(voiceGrant);

  return token.toJwt();
}

export { Twilio };
