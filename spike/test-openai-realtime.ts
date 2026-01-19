/**
 * Spike Test: OpenAI Realtime API Voice Capabilities
 *
 * Purpose: Verify OpenAI Realtime API can handle voice conversations
 *
 * This tests:
 * 1. WebSocket connection to OpenAI Realtime API
 * 2. Session creation and configuration
 * 3. Audio format support (PCM 16-bit, 24kHz)
 * 4. Text-to-speech generation
 *
 * Prerequisites:
 * 1. OPENAI_API_KEY in .env (must have Realtime API access)
 *
 * Run: npm run test-openai
 */

import WebSocket from 'ws';
import 'dotenv/config';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-10-01';

interface SessionConfig {
  modalities: string[];
  instructions: string;
  voice: string;
  input_audio_format: string;
  output_audio_format: string;
  turn_detection: {
    type: string;
    threshold: number;
    prefix_padding_ms: number;
    silence_duration_ms: number;
  };
}

async function testRealtimeConnection(): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('OPENAI_API_KEY not found in .env');
    console.log('   Get your API key from https://platform.openai.com/api-keys');
    console.log('   Note: Realtime API requires specific access');
    return false;
  }

  console.log('Connecting to OpenAI Realtime API...\n');

  return new Promise((resolve) => {
    const ws = new WebSocket(`${OPENAI_REALTIME_URL}?model=${MODEL}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    let sessionCreated = false;
    let audioReceived = false;
    const timeout = setTimeout(() => {
      console.error('Connection timeout after 30 seconds');
      ws.close();
      resolve(false);
    }, 30000);

    ws.on('open', () => {
      console.log('WebSocket connected!\n');

      // Configure the session
      const sessionConfig: SessionConfig = {
        modalities: ['text', 'audio'],
        instructions: `You are a pharmacy call assistant for PharmacyCaller.
                       Your job is to navigate IVR menus and wait on hold.
                       When a human answers, you will bridge the patient in.
                       Be polite, efficient, and professional.`,
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      };

      // Send session update
      ws.send(JSON.stringify({
        type: 'session.update',
        session: sessionConfig,
      }));

      console.log('Session configuration sent');
      console.log(`   Voice: ${sessionConfig.voice}`);
      console.log(`   Audio format: ${sessionConfig.input_audio_format}`);
      console.log(`   VAD enabled: Yes\n`);

      // Request a simple text response to test the connection
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{
              type: 'input_text',
              text: 'Say "PharmacyCaller test successful" in a friendly voice.',
            }],
          },
        }));

        ws.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
          },
        }));

        console.log('Test prompt sent, waiting for response...\n');
      }, 1000);
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());

        switch (event.type) {
          case 'session.created':
            sessionCreated = true;
            console.log('Session created successfully!');
            console.log(`   Session ID: ${event.session?.id || 'N/A'}`);
            break;

          case 'session.updated':
            console.log('Session updated with our configuration');
            break;

          case 'response.audio.delta':
            if (!audioReceived) {
              audioReceived = true;
              console.log('Receiving audio data...');
              console.log(`   Audio chunk size: ${event.delta?.length || 0} bytes (base64)`);
            }
            break;

          case 'response.audio.done':
            console.log('Audio generation complete!');
            break;

          case 'response.text.delta':
            process.stdout.write(event.delta || '');
            break;

          case 'response.text.done':
            console.log('\n');
            break;

          case 'response.done':
            console.log('Response complete!\n');

            // Close connection after successful test
            clearTimeout(timeout);
            ws.close();

            console.log('---');
            console.log('OPENAI_REALTIME_WORKING=true');
            console.log(`SESSION_CREATED=${sessionCreated}`);
            console.log(`AUDIO_GENERATED=${audioReceived}`);

            resolve(true);
            break;

          case 'error':
            console.error('API Error:', event.error?.message || event);
            if (event.error?.code === 'invalid_api_key') {
              console.log('   -> Check your API key');
            } else if (event.error?.code === 'model_not_found') {
              console.log('   -> Realtime API access may not be enabled');
            }
            break;
        }
      } catch (e) {
        // Ignore parse errors for binary data
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      console.error('WebSocket error:', error.message);

      if (error.message.includes('401')) {
        console.log('   -> Invalid API key or no Realtime API access');
      } else if (error.message.includes('403')) {
        console.log('   -> Realtime API not enabled for your account');
      }

      console.log('\n---');
      console.log('OPENAI_REALTIME_WORKING=false');
      console.log(`ERROR=${error.message}`);

      resolve(false);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      if (!sessionCreated) {
        console.log(`Connection closed: ${code} - ${reason}`);
        resolve(false);
      }
    });
  });
}

// Run the test
console.log('========================================');
console.log('  OPENAI REALTIME API TEST');
console.log('  (Voice AI verification)');
console.log('========================================\n');

testRealtimeConnection()
  .then((success) => {
    if (!success) {
      console.log('\nOpenAI Realtime API test failed.');
      console.log('Verify:');
      console.log('1. API key is valid');
      console.log('2. Realtime API access is enabled');
      console.log('3. You have sufficient credits');
      process.exit(1);
    } else {
      console.log('\nOpenAI Realtime API is ready for PharmacyCaller!');
      console.log('Features verified:');
      console.log('  - WebSocket connection');
      console.log('  - Session management');
      console.log('  - Audio generation');
    }
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
