import { env } from './env.js';

export const openaiConfig = {
  apiKey: env.OPENAI_API_KEY,
  realtimeUrl: 'wss://api.openai.com/v1/realtime',
  realtimeModel: 'gpt-realtime',
  voice: 'alloy',
  audioFormat: 'pcm16',
  sampleRate: 24000,
};
