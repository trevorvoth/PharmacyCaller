import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';
import { EventEmitter } from 'events';

const streamLogger = logger.child({ service: 'twilio-media-streams' });

export interface MediaStreamMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // Base64 encoded audio
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
  mark?: {
    name: string;
  };
}

export interface MediaStreamEvents {
  connected: (streamSid: string, callSid: string) => void;
  audio: (payload: Buffer, timestamp: string) => void;
  stopped: () => void;
  error: (error: Error) => void;
}

export class TwilioMediaStreamHandler extends EventEmitter {
  private ws: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private sequenceNumber = 0;

  constructor() {
    super();
  }

  handleConnection(ws: WebSocket): void {
    this.ws = ws;

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as MediaStreamMessage;
        this.handleMessage(message);
      } catch (error) {
        streamLogger.error({ err: error }, 'Failed to parse media stream message');
      }
    });

    ws.on('close', () => {
      streamLogger.info({ streamSid: this.streamSid }, 'Media stream closed');
      this.emit('stopped');
    });

    ws.on('error', (error) => {
      streamLogger.error({ err: error, streamSid: this.streamSid }, 'Media stream error');
      this.emit('error', error);
    });
  }

  private handleMessage(message: MediaStreamMessage): void {
    switch (message.event) {
      case 'connected':
        streamLogger.debug('Media stream WebSocket connected');
        break;

      case 'start':
        if (message.start) {
          this.streamSid = message.start.streamSid;
          this.callSid = message.start.callSid;
          streamLogger.info({
            streamSid: this.streamSid,
            callSid: this.callSid,
            mediaFormat: message.start.mediaFormat,
          }, 'Media stream started');
          this.emit('connected', this.streamSid, this.callSid);
        }
        break;

      case 'media':
        if (message.media) {
          // Decode base64 audio payload
          const audioBuffer = Buffer.from(message.media.payload, 'base64');
          this.emit('audio', audioBuffer, message.media.timestamp);
        }
        break;

      case 'stop':
        streamLogger.info({ streamSid: this.streamSid }, 'Media stream stopped');
        this.emit('stopped');
        break;

      case 'mark':
        streamLogger.debug({ mark: message.mark?.name }, 'Received mark');
        break;

      default:
        streamLogger.debug({ event: message.event }, 'Unknown media stream event');
    }
  }

  sendAudio(audioBuffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.streamSid) {
      return;
    }

    const message = {
      event: 'media',
      streamSid: this.streamSid,
      media: {
        payload: audioBuffer.toString('base64'),
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  sendMark(name: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.streamSid) {
      return;
    }

    const message = {
      event: 'mark',
      streamSid: this.streamSid,
      mark: { name },
    };

    this.ws.send(JSON.stringify(message));
  }

  sendClear(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.streamSid) {
      return;
    }

    const message = {
      event: 'clear',
      streamSid: this.streamSid,
    };

    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getStreamSid(): string | null {
    return this.streamSid;
  }

  getCallSid(): string | null {
    return this.callSid;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
