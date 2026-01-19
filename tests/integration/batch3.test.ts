import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { twilioConfig } from '../../src/config/twilio.js';
import { openaiConfig } from '../../src/config/openai.js';
import { twilioClient } from '../../src/services/twilio/client.js';
import {
  initiateCall,
  generateTwimlResponse,
  generateMediaStreamTwiml,
  generateConferenceJoinTwiml,
  generateSayTwiml
} from '../../src/services/twilio/calls.js';
import {
  generateConferenceName,
  getConferenceByName,
} from '../../src/services/twilio/conference.js';
import { TwilioMediaStreamHandler } from '../../src/services/twilio/mediaStreams.js';
import { OpenAIRealtimeClient } from '../../src/services/openai/realtimeClient.js';
import { getPharmacyIVRPrompt, getHumanGreetingPrompt, getPoliteEndingPrompt } from '../../src/services/openai/prompts.js';
import { AudioBridge } from '../../src/services/audioBridge.js';
import { costTracker } from '../../src/services/costTracker.js';
import { costAlerts } from '../../src/services/costAlerts.js';
import { ivrRouter } from '../../src/services/openai/ivrRouter.js';
import { ivrFallback } from '../../src/services/openai/ivrFallback.js';
import { redis } from '../../src/services/redis.js';
import { EventEmitter } from 'events';

// Mock Twilio client for unit tests
vi.mock('../../src/services/twilio/client.js', () => ({
  twilioClient: {
    calls: {
      create: vi.fn().mockResolvedValue({
        sid: 'CA_mock_call_sid_123',
        status: 'queued',
        to: '+15551234567',
        from: '+15559876543',
      }),
    },
    conferences: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('Batch 3: Twilio + OpenAI Realtime Integration', () => {
  beforeAll(async () => {
    // Clear any existing test data
    const keys = await redis.keys('test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    // Clean up
    const keys = await redis.keys('test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  describe('Twilio Configuration', () => {
    it('should have valid Twilio config structure', () => {
      expect(twilioConfig).toHaveProperty('accountSid');
      expect(twilioConfig).toHaveProperty('authToken');
      expect(twilioConfig).toHaveProperty('phoneNumber');
    });
  });

  describe('OpenAI Configuration', () => {
    it('should have valid OpenAI config structure', () => {
      expect(openaiConfig).toHaveProperty('apiKey');
      expect(openaiConfig).toHaveProperty('realtimeModel');
      expect(openaiConfig).toHaveProperty('voice');
      expect(openaiConfig).toHaveProperty('realtimeUrl');
    });

    it('should have valid audio format settings', () => {
      expect(openaiConfig.audioFormat).toBe('pcm16');
      expect(openaiConfig.sampleRate).toBe(24000);
    });
  });

  describe('Twilio Call Service', () => {
    it('should generate valid TwiML response', () => {
      const twiml = generateTwimlResponse('<Say>Hello</Say>');

      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Say>Hello</Say>');
      expect(twiml).toContain('</Response>');
    });

    it('should generate Say TwiML', () => {
      const twiml = generateSayTwiml('Welcome to the pharmacy', 'alice');

      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Say');
      expect(twiml).toContain('Welcome to the pharmacy');
      expect(twiml).toContain('voice="alice"');
    });

    it('should generate TwiML with media stream', () => {
      const twiml = generateMediaStreamTwiml('wss://example.com/stream', 'test-stream');

      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Connect>');
      expect(twiml).toContain('<Stream');
      expect(twiml).toContain('wss://example.com/stream');
      expect(twiml).toContain('test-stream');
    });

    it('should generate conference join TwiML', () => {
      const twiml = generateConferenceJoinTwiml('test-conference', {
        startOnEnter: true,
        endOnExit: false,
      });

      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Dial>');
      expect(twiml).toContain('<Conference');
      expect(twiml).toContain('test-conference');
      expect(twiml).toContain('startConferenceOnEnter="true"');
    });

    it('should initiate a call with correct parameters', async () => {
      const result = await initiateCall({
        to: '+15551234567',
        webhookUrl: 'https://example.com/webhook',
        statusCallbackUrl: 'https://example.com/status',
      });

      expect(result).toHaveProperty('callSid');
      expect(result).toHaveProperty('status');
      expect(result.callSid).toBe('CA_mock_call_sid_123');
    });
  });

  describe('Conference Service', () => {
    it('should generate unique conference names', () => {
      const name1 = generateConferenceName('search-1', 'pharmacy-1');
      const name2 = generateConferenceName('search-1', 'pharmacy-2');

      expect(name1).not.toBe(name2);
      expect(name1).toContain('pharmacy-');
      expect(name1).toContain('search-1');
    });

    it('should return null for non-existent conference', async () => {
      const result = await getConferenceByName('non-existent-conference');
      expect(result).toBeNull();
    });
  });

  describe('Twilio Media Streams Handler', () => {
    it('should create handler instance', () => {
      const handler = new TwilioMediaStreamHandler();

      expect(handler).toBeInstanceOf(EventEmitter);
      expect(typeof handler.sendAudio).toBe('function');
      expect(typeof handler.sendMark).toBe('function');
      expect(typeof handler.close).toBe('function');
    });

    it('should track connection state', () => {
      const handler = new TwilioMediaStreamHandler();

      expect(handler.isConnected()).toBe(false);
      expect(handler.getStreamSid()).toBeNull();
      expect(handler.getCallSid()).toBeNull();
    });
  });

  describe('OpenAI Realtime Client', () => {
    it('should have correct event emitter interface', () => {
      const client = new OpenAIRealtimeClient();

      expect(client).toBeInstanceOf(EventEmitter);
      expect(typeof client.connect).toBe('function');
      expect(typeof client.sendAudio).toBe('function');
      expect(typeof client.sendText).toBe('function');
      expect(typeof client.disconnect).toBe('function');
    });

    it('should track connection state', () => {
      const client = new OpenAIRealtimeClient();

      expect(client.isConnected()).toBe(false);
    });
  });

  describe('IVR Prompts', () => {
    it('should generate IVR navigation prompt', () => {
      const prompt = getPharmacyIVRPrompt({
        pharmacyName: 'CVS Pharmacy',
        pharmacyChain: 'CVS',
      });

      expect(prompt).toContain('CVS');
      expect(prompt).toContain('pharmacy');
      expect(prompt.toLowerCase()).toContain('ivr');
    });

    it('should include chain-specific instructions', () => {
      const prompt = getPharmacyIVRPrompt({
        pharmacyName: 'Walgreens',
        pharmacyChain: 'WALGREENS',
      });

      expect(prompt).toContain('Walgreens');
    });

    it('should include medication query when provided', () => {
      const prompt = getPharmacyIVRPrompt({
        pharmacyName: 'CVS',
        medicationQuery: 'Ozempic',
      });

      expect(prompt).toContain('Ozempic');
    });

    it('should have human greeting prompt', () => {
      const prompt = getHumanGreetingPrompt();
      expect(prompt).toContain('hold');
      expect(prompt).toContain('patient');
    });

    it('should have polite ending prompt', () => {
      const prompt = getPoliteEndingPrompt();
      expect(prompt.length).toBeGreaterThan(20);
    });
  });

  describe('Audio Bridge', () => {
    it('should create bridge instance', () => {
      const bridge = new AudioBridge();

      expect(bridge).toBeInstanceOf(EventEmitter);
      expect(typeof bridge.connect).toBe('function');
      expect(typeof bridge.disconnect).toBe('function');
      expect(typeof bridge.isConnected).toBe('function');
    });

    it('should track connection state', () => {
      const bridge = new AudioBridge();

      expect(bridge.isConnected()).toBe(false);
      expect(bridge.getCallSid()).toBeNull();
    });

    it('should have text sending capability', () => {
      const bridge = new AudioBridge();

      expect(typeof bridge.sendTextToAI).toBe('function');
      expect(typeof bridge.cancelAIResponse).toBe('function');
    });
  });

  describe('Cost Tracker', () => {
    it('should calculate call cost correctly', () => {
      // 10 minutes of outbound call, 5 minutes conference, 8 minutes AI
      const cost = costTracker.calculateCallCost(600, 300, 8);

      expect(cost).toHaveProperty('twilioOutbound');
      expect(cost).toHaveProperty('twilioConference');
      expect(cost).toHaveProperty('openaiRealtime');
      expect(cost).toHaveProperty('total');
      expect(cost.total).toBe(cost.twilioOutbound + cost.twilioConference + cost.openaiRealtime);
    });

    it('should calculate zero cost for zero duration', () => {
      const cost = costTracker.calculateCallCost(0, 0, 0);

      expect(cost.total).toBe(0);
    });

    it('should get daily cost', async () => {
      const dailyCost = await costTracker.getDailyCost();
      expect(typeof dailyCost).toBe('number');
      expect(dailyCost).toBeGreaterThanOrEqual(0);
    });

    it('should get daily cost summary', async () => {
      const summary = await costTracker.getDailyCostSummary();

      expect(summary).toHaveProperty('date');
      expect(summary).toHaveProperty('totalCents');
      expect(summary).toHaveProperty('callCount');
      expect(summary).toHaveProperty('averageCostPerCall');
    });
  });

  describe('Cost Alerts', () => {
    it('should get alert config', () => {
      const config = costAlerts.getConfig();

      expect(config).toHaveProperty('thresholdCents');
      expect(typeof config.thresholdCents).toBe('number');
    });

    it('should check daily threshold', async () => {
      const result = await costAlerts.checkDailyThreshold();
      expect(typeof result).toBe('boolean');
    });

    it('should check if near threshold', async () => {
      const result = await costAlerts.isNearThreshold(80);
      expect(typeof result).toBe('boolean');
    });

    it('should format cost correctly', () => {
      expect(costAlerts.formatCost(100)).toBe('$1.00');
      expect(costAlerts.formatCost(1550)).toBe('$15.50');
      expect(costAlerts.formatCost(0)).toBe('$0.00');
    });

    it('should get alert history', async () => {
      const history = await costAlerts.getAlertHistory(5);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('IVR Router', () => {
    it('should detect CVS chain from name', () => {
      const chain = ivrRouter.detectChain('CVS Pharmacy #1234');
      expect(chain).toBe('CVS');
    });

    it('should detect Walgreens chain from name', () => {
      const chain = ivrRouter.detectChain('Walgreens Store');
      expect(chain).toBe('WALGREENS');
    });

    it('should detect Rite Aid chain from name', () => {
      const chain = ivrRouter.detectChain('Rite Aid Pharmacy');
      expect(chain).toBe('RITE_AID');
    });

    it('should return null for unknown chains', () => {
      const chain = ivrRouter.detectChain('Local Independent Pharmacy');
      expect(chain).toBeNull();
    });

    it('should get IVR pattern for known chain', () => {
      const pattern = ivrRouter.getPattern('CVS');

      expect(pattern).toHaveProperty('chain');
      expect(pattern).toHaveProperty('patterns');
      expect(pattern).toHaveProperty('holdMusic');
      expect(pattern).toHaveProperty('humanIndicators');
      expect(pattern.chain).toBe('CVS');
    });

    it('should return default pattern for unknown chain', () => {
      const pattern = ivrRouter.getPattern(null);

      expect(pattern.chain).toBe('GENERIC');
    });

    it('should detect human speaking', () => {
      expect(ivrRouter.isHumanSpeaking('How can I help you today?', 'CVS')).toBe(true);
      expect(ivrRouter.isHumanSpeaking('Press 1 for pharmacy', 'CVS')).toBe(false);
    });

    it('should detect hold status', () => {
      expect(ivrRouter.isOnHold('Please hold, your call is important to us', null)).toBe(true);
      expect(ivrRouter.isOnHold('Welcome to the pharmacy', null)).toBe(false);
    });

    it('should suggest actions for prompts', () => {
      const action = ivrRouter.suggestAction('Press 1 for pharmacy', 'CVS');
      expect(action).toBe('press 1');
    });

    it('should generate IVR instructions', () => {
      const instructions = ivrRouter.getInstructions('CVS Pharmacy', 'CVS');

      expect(instructions).toContain('CVS');
      expect(instructions).toContain('Menu Navigation');
      expect(instructions).toContain('Tips');
    });
  });

  describe('IVR Fallback', () => {
    const testCallId = 'test-ivr-' + Date.now();

    it('should initialize navigation state', () => {
      const state = ivrFallback.initNavigation(testCallId, 'Test Pharmacy');

      expect(state.callId).toBe(testCallId);
      expect(state.pharmacyName).toBe('Test Pharmacy');
      expect(state.attempts).toBe(0);
      expect(state.status).toBe('navigating');
    });

    it('should get navigation state', () => {
      const state = ivrFallback.getState(testCallId);

      expect(state).not.toBeUndefined();
      expect(state?.callId).toBe(testCallId);
    });

    it('should record attempts', () => {
      ivrFallback.recordAttempt(testCallId);
      ivrFallback.recordAttempt(testCallId, 'Menu option not recognized');

      const state = ivrFallback.getState(testCallId);
      expect(state?.attempts).toBe(2);
      expect(state?.errors).toContain('Menu option not recognized');
    });

    it('should check retry eligibility', () => {
      const shouldRetry = ivrFallback.shouldRetry(testCallId);
      expect(shouldRetry).toBe(true); // Only 2 attempts, max is 3
    });

    it('should not retry after max attempts', () => {
      ivrFallback.recordAttempt(testCallId);

      const shouldRetry = ivrFallback.shouldRetry(testCallId);
      expect(shouldRetry).toBe(false); // Now at 3 attempts
    });

    it('should mark navigation as failed', async () => {
      const result = await ivrFallback.markFailed(testCallId);

      expect(result.shouldNotifyUser).toBe(true);
      expect(result.message).toContain('Test Pharmacy');
      expect(result.errors.length).toBeGreaterThan(0);

      const state = ivrFallback.getState(testCallId);
      expect(state?.status).toBe('failed');
    });

    it('should mark navigation as success', async () => {
      const successCallId = 'test-ivr-success-' + Date.now();
      ivrFallback.initNavigation(successCallId, 'Success Pharmacy');

      await ivrFallback.markSuccess(successCallId, 'human_detected');

      const state = ivrFallback.getState(successCallId);
      expect(state?.status).toBe('human_detected');

      // Cleanup
      ivrFallback.cleanup(successCallId);
    });

    it('should get active navigations', () => {
      const activeCallId = 'test-ivr-active-' + Date.now();
      ivrFallback.initNavigation(activeCallId, 'Active Pharmacy');

      const active = ivrFallback.getActiveNavigations();
      expect(active.some(n => n.callId === activeCallId)).toBe(true);

      // Cleanup
      ivrFallback.cleanup(activeCallId);
    });

    it('should generate fallback message', () => {
      const message = ivrFallback.getFallbackMessage('Test Pharmacy');

      expect(message).toContain('Test Pharmacy');
      expect(message).toContain('automated phone system');
    });

    afterAll(() => {
      ivrFallback.cleanup(testCallId);
    });
  });
});
