import WebSocket from 'ws';
import { openaiConfig } from '../../config/openai.js';
import { logger } from '../../utils/logger.js';
import { EventEmitter } from 'events';

const realtimeLogger = logger.child({ service: 'openai-realtime' });

export interface RealtimeSessionConfig {
  instructions: string;
  voice?: string;
  inputAudioFormat?: string;
  outputAudioFormat?: string;
  turnDetection?: {
    type: 'server_vad';
    threshold?: number;
    prefixPaddingMs?: number;
    silenceDurationMs?: number;
  };
}

export interface RealtimeEvent {
  type: string;
  session?: {
    id: string;
  };
  response?: {
    id: string;
    status: string;
  };
  delta?: string;
  error?: {
    type: string;
    message: string;
    code?: string;
  };
}

export interface RealtimeEvents {
  connected: (sessionId: string) => void;
  audio: (audioBuffer: Buffer) => void;
  transcript: (text: string, isFinal: boolean) => void;
  functionCall: (name: string, args: Record<string, unknown>) => void;
  error: (error: Error) => void;
  disconnected: () => void;
}

export class OpenAIRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private connected = false;

  async connect(config: RealtimeSessionConfig): Promise<void> {
    const url = `${openaiConfig.realtimeUrl}?model=${openaiConfig.realtimeModel}`;

    realtimeLogger.info({ model: openaiConfig.realtimeModel }, 'Connecting to OpenAI Realtime');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${openaiConfig.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 30000);

      this.ws.on('open', () => {
        realtimeLogger.info('WebSocket connected, configuring session');
        this.configureSession(config);
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString()) as RealtimeEvent;
          this.handleEvent(event, resolve, clearTimeout.bind(null, timeout));
        } catch (error) {
          realtimeLogger.error({ err: error }, 'Failed to parse realtime event');
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        realtimeLogger.error({ err: error }, 'WebSocket error');
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', () => {
        clearTimeout(timeout);
        this.connected = false;
        realtimeLogger.info('WebSocket closed');
        this.emit('disconnected');
      });
    });
  }

  private configureSession(config: RealtimeSessionConfig): void {
    const sessionConfig = {
      modalities: ['text', 'audio'],
      instructions: config.instructions,
      voice: config.voice ?? openaiConfig.voice,
      input_audio_format: config.inputAudioFormat ?? openaiConfig.audioFormat,
      output_audio_format: config.outputAudioFormat ?? openaiConfig.audioFormat,
      turn_detection: config.turnDetection ?? {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
    };

    this.send({
      type: 'session.update',
      session: sessionConfig,
    });
  }

  private handleEvent(
    event: RealtimeEvent,
    resolve: () => void,
    clearTimeoutFn: () => void
  ): void {
    switch (event.type) {
      case 'session.created':
        this.sessionId = event.session?.id ?? null;
        realtimeLogger.info({ sessionId: this.sessionId }, 'Session created');
        break;

      case 'session.updated':
        this.connected = true;
        realtimeLogger.info({ sessionId: this.sessionId }, 'Session configured');
        this.emit('connected', this.sessionId);
        clearTimeoutFn();
        resolve();
        break;

      case 'response.audio.delta':
        if (event.delta) {
          const audioBuffer = Buffer.from(event.delta, 'base64');
          this.emit('audio', audioBuffer);
        }
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.emit('transcript', event.delta, false);
        }
        break;

      case 'response.audio_transcript.done':
        // Final transcript
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // User speech transcript
        break;

      case 'response.function_call_arguments.done':
        // Handle function calls for IVR navigation
        break;

      case 'error':
        if (event.error) {
          const error = new Error(event.error.message);
          realtimeLogger.error({ error: event.error }, 'Realtime API error');
          this.emit('error', error);
        }
        break;

      default:
        realtimeLogger.debug({ type: event.type }, 'Unhandled realtime event');
    }
  }

  sendAudio(audioBuffer: Buffer): void {
    if (!this.connected) {
      return;
    }

    this.send({
      type: 'input_audio_buffer.append',
      audio: audioBuffer.toString('base64'),
    });
  }

  commitAudio(): void {
    if (!this.connected) {
      return;
    }

    this.send({
      type: 'input_audio_buffer.commit',
    });
  }

  clearAudio(): void {
    if (!this.connected) {
      return;
    }

    this.send({
      type: 'input_audio_buffer.clear',
    });
  }

  sendText(text: string): void {
    if (!this.connected) {
      return;
    }

    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text,
        }],
      },
    });

    this.send({
      type: 'response.create',
    });
  }

  cancelResponse(): void {
    if (!this.connected) {
      return;
    }

    this.send({
      type: 'response.cancel',
    });
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}
