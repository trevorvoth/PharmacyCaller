/**
 * Spike Test: Twilio Conference Call / Call Bridging
 *
 * Purpose: Verify we can create a conference and add participants
 * This is CRITICAL for the patient bridging feature.
 *
 * How it works:
 * 1. Creates a conference room
 * 2. Calls your test phone and adds to conference
 * 3. (Optionally) calls second phone and adds to same conference
 * 4. Both parties can now speak to each other
 *
 * Prerequisites:
 * 1. Twilio credentials in .env
 * 2. TEST_PHONE_NUMBER in .env
 * 3. TRANSFER_PHONE_NUMBER in .env (optional, for full bridge test)
 * 4. WEBHOOK_BASE_URL in .env (ngrok URL for status callbacks)
 *
 * Run: npm run test-conference
 */

import twilio from 'twilio';
import express from 'express';
import 'dotenv/config';

const app = express();
app.use(express.urlencoded({ extended: true }));

// Store conference state
let conferenceState = {
  conferenceSid: '',
  participants: [] as string[],
  allJoined: false,
};

// Generate unique conference name
const conferenceName = `pharmacycaller-test-${Date.now()}`;

async function startConferenceTest(): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
  const testPhone = process.env.TEST_PHONE_NUMBER;
  const transferPhone = process.env.TRANSFER_PHONE_NUMBER;
  const webhookBase = process.env.WEBHOOK_BASE_URL;

  // Validate configuration
  const missingVars: string[] = [];
  if (!accountSid) missingVars.push('TWILIO_ACCOUNT_SID');
  if (!authToken) missingVars.push('TWILIO_AUTH_TOKEN');
  if (!twilioNumber) missingVars.push('TWILIO_PHONE_NUMBER');
  if (!testPhone) missingVars.push('TEST_PHONE_NUMBER');

  if (missingVars.length > 0) {
    console.error('Missing required environment variables:');
    missingVars.forEach((v) => console.error(`   - ${v}`));
    process.exit(1);
  }

  if (!webhookBase) {
    console.warn('WARNING: WEBHOOK_BASE_URL not set');
    console.warn('   Conference status callbacks will not work');
    console.warn('   Use ngrok: ngrok http 3456\n');
  }

  const client = twilio(accountSid, authToken);

  console.log('Conference Configuration:');
  console.log(`   Name: ${conferenceName}`);
  console.log(`   Phone 1 (You): ${testPhone}`);
  console.log(`   Phone 2 (Transfer): ${transferPhone || 'Not configured'}`);
  console.log(`   Webhook: ${webhookBase || 'None'}\n`);

  // Set up webhook endpoints
  setupWebhooks(webhookBase || '');

  // Start local server for webhooks
  const port = 3456;
  const server = app.listen(port, () => {
    console.log(`Webhook server listening on port ${port}\n`);
  });

  try {
    // Call first participant (you)
    console.log('Calling first participant...');
    const call1 = await client.calls.create({
      to: testPhone!,
      from: twilioNumber!,
      twiml: generateConferenceTwiml(conferenceName, 'Participant 1', webhookBase),
      statusCallback: webhookBase ? `${webhookBase}/call-status` : undefined,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    console.log(`   Call SID: ${call1.sid}`);
    console.log('   Waiting for you to answer...\n');

    // If transfer phone is configured, call them too
    if (transferPhone) {
      // Wait a few seconds for first call to connect
      await new Promise((resolve) => setTimeout(resolve, 5000));

      console.log('Calling second participant...');
      const call2 = await client.calls.create({
        to: transferPhone,
        from: twilioNumber!,
        twiml: generateConferenceTwiml(conferenceName, 'Participant 2', webhookBase),
        statusCallback: webhookBase ? `${webhookBase}/call-status` : undefined,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });

      console.log(`   Call SID: ${call2.sid}`);
      console.log('   Waiting for them to answer...\n');
    }

    // Wait for test to complete (timeout after 2 minutes)
    console.log('Conference test in progress...');
    console.log('Both phones should ring. When you answer, you will be in a conference.\n');

    await new Promise((resolve) => setTimeout(resolve, 120000));

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error:', errorMessage);

    console.log('\n---');
    console.log('CONFERENCE_WORKING=false');
    console.log(`ERROR=${errorMessage}`);

  } finally {
    server.close();
  }
}

function generateConferenceTwiml(
  confName: string,
  participantLabel: string,
  webhookBase: string | undefined
): string {
  const statusCallback = webhookBase
    ? `statusCallback="${webhookBase}/conference-status" statusCallbackEvent="start end join leave"`
    : '';

  return `
    <Response>
      <Say voice="alice">
        Welcome to PharmacyCaller conference test.
        You are ${participantLabel}.
        Connecting you to the conference now.
      </Say>
      <Dial>
        <Conference
          ${statusCallback}
          startConferenceOnEnter="true"
          endConferenceOnExit="false"
          waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"
        >
          ${confName}
        </Conference>
      </Dial>
      <Say voice="alice">
        The conference has ended. Goodbye!
      </Say>
    </Response>
  `;
}

function setupWebhooks(baseUrl: string): void {
  // Conference status webhook
  app.post('/conference-status', (req, res) => {
    const event = req.body.StatusCallbackEvent;
    const confSid = req.body.ConferenceSid;
    const participant = req.body.CallSid;

    console.log(`[Conference] ${event}`);

    switch (event) {
      case 'conference-start':
        console.log(`   Conference started: ${confSid}`);
        conferenceState.conferenceSid = confSid;
        break;

      case 'participant-join':
        console.log(`   Participant joined: ${participant}`);
        conferenceState.participants.push(participant);

        if (conferenceState.participants.length >= 2) {
          conferenceState.allJoined = true;
          console.log('\n*** BRIDGE SUCCESSFUL! Both parties connected! ***\n');
          console.log('---');
          console.log('CONFERENCE_WORKING=true');
          console.log('BRIDGE_CAPABLE=true');
          console.log(`CONFERENCE_SID=${confSid}`);
        }
        break;

      case 'participant-leave':
        console.log(`   Participant left: ${participant}`);
        break;

      case 'conference-end':
        console.log(`   Conference ended: ${confSid}`);
        break;
    }

    res.sendStatus(200);
  });

  // Call status webhook
  app.post('/call-status', (req, res) => {
    const status = req.body.CallStatus;
    const callSid = req.body.CallSid;

    console.log(`[Call ${callSid.slice(-6)}] Status: ${status}`);

    res.sendStatus(200);
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      conference: conferenceName,
      participants: conferenceState.participants.length,
    });
  });
}

// Run the test
console.log('========================================');
console.log('  TWILIO CONFERENCE/BRIDGE TEST');
console.log('  (Critical for patient bridging)');
console.log('========================================\n');

console.log('This test verifies that we can:');
console.log('1. Create a conference room');
console.log('2. Add multiple participants');
console.log('3. Bridge calls together\n');

console.log('IMPORTANT: For full test, you need:');
console.log('- ngrok running: ngrok http 3456');
console.log('- WEBHOOK_BASE_URL set to your ngrok URL');
console.log('- Two phone numbers for testing\n');

startConferenceTest()
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
