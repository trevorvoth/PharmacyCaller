import { env } from './env.js';

export const twilioConfig = {
  accountSid: env.TWILIO_ACCOUNT_SID,
  authToken: env.TWILIO_AUTH_TOKEN,
  phoneNumber: env.TWILIO_PHONE_NUMBER,
  apiKeySid: env.TWILIO_API_KEY_SID,
  apiKeySecret: env.TWILIO_API_KEY_SECRET,
};
