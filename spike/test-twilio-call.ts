/**
 * Spike Test: Basic Twilio Outbound Call
 *
 * Purpose: Verify we can initiate outbound calls via Twilio
 *
 * Prerequisites:
 * 1. TWILIO_ACCOUNT_SID in .env
 * 2. TWILIO_AUTH_TOKEN in .env
 * 3. TWILIO_PHONE_NUMBER in .env (your Twilio number)
 * 4. TEST_PHONE_NUMBER in .env (your phone to receive test calls)
 *
 * Run: npm run test-twilio
 */

import twilio from 'twilio';
import 'dotenv/config';

interface CallResult {
  success: boolean;
  callSid?: string;
  error?: string;
}

async function initiateTestCall(): Promise<CallResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
  const testPhone = process.env.TEST_PHONE_NUMBER;

  // Validate configuration
  if (!accountSid) {
    console.error('TWILIO_ACCOUNT_SID not found in .env');
    return { success: false, error: 'Missing TWILIO_ACCOUNT_SID' };
  }

  if (!authToken) {
    console.error('TWILIO_AUTH_TOKEN not found in .env');
    return { success: false, error: 'Missing TWILIO_AUTH_TOKEN' };
  }

  if (!twilioNumber) {
    console.error('TWILIO_PHONE_NUMBER not found in .env');
    return { success: false, error: 'Missing TWILIO_PHONE_NUMBER' };
  }

  if (!testPhone) {
    console.error('TEST_PHONE_NUMBER not found in .env');
    return { success: false, error: 'Missing TEST_PHONE_NUMBER' };
  }

  console.log('Initiating Twilio test call...');
  console.log(`   From: ${twilioNumber}`);
  console.log(`   To: ${testPhone}\n`);

  const client = twilio(accountSid, authToken);

  try {
    // Create a simple call with TwiML that speaks a message
    const call = await client.calls.create({
      to: testPhone,
      from: twilioNumber,
      twiml: `
        <Response>
          <Say voice="alice">
            Hello! This is a test call from PharmacyCaller.
            If you can hear this message clearly, the Twilio integration is working.
            Press any key to confirm, or simply hang up.
          </Say>
          <Gather numDigits="1" timeout="10">
            <Say voice="alice">Waiting for your input.</Say>
          </Gather>
          <Say voice="alice">
            No input received. Test complete. Goodbye!
          </Say>
        </Response>
      `,
    });

    console.log('Call initiated successfully!');
    console.log(`   Call SID: ${call.sid}`);
    console.log(`   Status: ${call.status}\n`);

    console.log('Your phone should ring shortly...\n');
    console.log('Next steps:');
    console.log('1. Answer the call');
    console.log('2. Listen to the message');
    console.log('3. Press any key to confirm');
    console.log('4. Note audio quality\n');

    console.log('---');
    console.log('TWILIO_CALL_WORKING=true');
    console.log(`CALL_SID=${call.sid}`);

    return { success: true, callSid: call.sid };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('API Error:', errorMessage);

    if (errorMessage.includes('authenticate')) {
      console.log('   -> Check your Account SID and Auth Token');
    } else if (errorMessage.includes('phone number')) {
      console.log('   -> Check phone number format (E.164: +1XXXXXXXXXX)');
    } else if (errorMessage.includes('not verified')) {
      console.log('   -> Add test phone to verified numbers in Twilio console');
    }

    console.log('---');
    console.log('TWILIO_CALL_WORKING=false');
    console.log(`ERROR=${errorMessage}`);

    return { success: false, error: errorMessage };
  }
}

// Run the test
console.log('========================================');
console.log('  TWILIO OUTBOUND CALL TEST');
console.log('  (Basic telephony verification)');
console.log('========================================\n');

initiateTestCall()
  .then((result) => {
    if (!result.success) {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
