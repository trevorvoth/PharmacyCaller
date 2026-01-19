import { EventEmitter } from 'events';
import { TwilioMediaStreamHandler } from './twilio/mediaStreams.js';
import { OpenAIRealtimeClient, type RealtimeSessionConfig } from './openai/realtimeClient.js';
import { logger } from '../utils/logger.js';

const bridgeLogger = logger.child({ service: 'audio-bridge' });

export interface AudioBridgeConfig {
  sessionConfig: RealtimeSessionConfig;
}

export interface AudioBridgeEvents {
  connected: () => void;
  humanDetected: () => void;
  voicemailDetected: () => void;
  ivrFailed: () => void;
  transcript: (text: string, speaker: 'ai' | 'pharmacy') => void;
  error: (error: Error) => void;
  disconnected: () => void;
}

export class AudioBridge extends EventEmitter {
  private mediaStream: TwilioMediaStreamHandler;
  private realtimeClient: OpenAIRealtimeClient;
  private connected = false;
  private callSid: string | null = null;

  constructor() {
    super();
    this.mediaStream = new TwilioMediaStreamHandler();
    this.realtimeClient = new OpenAIRealtimeClient();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle audio from Twilio (pharmacy side) -> send to OpenAI
    this.mediaStream.on('audio', (audioBuffer: Buffer) => {
      if (this.realtimeClient.isConnected()) {
        this.realtimeClient.sendAudio(audioBuffer);
      }
    });

    this.mediaStream.on('connected', (streamSid: string, callSid: string) => {
      this.callSid = callSid;
      bridgeLogger.info({ streamSid, callSid }, 'Twilio media stream connected');
    });

    this.mediaStream.on('stopped', () => {
      bridgeLogger.info('Twilio media stream stopped');
      this.disconnect();
    });

    this.mediaStream.on('error', (error: Error) => {
      bridgeLogger.error({ err: error }, 'Twilio media stream error');
      this.emit('error', error);
    });

    // Handle audio from OpenAI (AI voice) -> send to Twilio
    this.realtimeClient.on('audio', (audioBuffer: Buffer) => {
      if (this.mediaStream.isConnected()) {
        this.mediaStream.sendAudio(audioBuffer);
      }
    });

    this.realtimeClient.on('connected', (sessionId: string) => {
      this.connected = true;
      bridgeLogger.info({ sessionId }, 'OpenAI Realtime connected');
      this.emit('connected');
    });

    this.realtimeClient.on('transcript', (text: string) => {
      // Check for special signals in the AI's response
      this.checkForSignals(text);
      this.emit('transcript', text, 'ai');
    });

    this.realtimeClient.on('error', (error: Error) => {
      bridgeLogger.error({ err: error }, 'OpenAI Realtime error');
      this.emit('error', error);
    });

    this.realtimeClient.on('disconnected', () => {
      bridgeLogger.info('OpenAI Realtime disconnected');
      this.disconnect();
    });
  }

  private checkForSignals(text: string): void {
    const upperText = text.toUpperCase();

    if (upperText.includes('[HUMAN_DETECTED]')) {
      bridgeLogger.info('Human pharmacist detected');
      this.emit('humanDetected');
    } else if (upperText.includes('[VOICEMAIL_DETECTED]')) {
      bridgeLogger.info('Voicemail detected');
      this.emit('voicemailDetected');
    } else if (upperText.includes('[IVR_FAILED]')) {
      bridgeLogger.info('IVR navigation failed');
      this.emit('ivrFailed');
    }
  }

  async connect(
    ws: import('ws').WebSocket,
    config: AudioBridgeConfig
  ): Promise<void> {
    bridgeLogger.info('Starting audio bridge');

    // Connect Twilio media stream
    this.mediaStream.handleConnection(ws);

    // Connect to OpenAI Realtime
    await this.realtimeClient.connect(config.sessionConfig);

    bridgeLogger.info('Audio bridge connected');
  }

  disconnect(): void {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    bridgeLogger.info('Disconnecting audio bridge');

    this.mediaStream.close();
    this.realtimeClient.disconnect();

    this.emit('disconnected');
  }

  sendTextToAI(text: string): void {
    if (this.realtimeClient.isConnected()) {
      this.realtimeClient.sendText(text);
    }
  }

  cancelAIResponse(): void {
    if (this.realtimeClient.isConnected()) {
      this.realtimeClient.cancelResponse();
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCallSid(): string | null {
    return this.callSid;
  }
}
