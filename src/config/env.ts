import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Server
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string(),
  TWILIO_PHONE_NUMBER: z.string().startsWith('+'),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().startsWith('sk-'),

  // Google Places
  GOOGLE_PLACES_API_KEY: z.string(),

  // Sentry
  SENTRY_DSN: z.string().url().optional(),

  // Cost Alerts
  COST_ALERT_THRESHOLD: z.string().default('50').transform(Number),
  COST_ALERT_EMAIL: z.string().email().optional(),
});

function validateEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }

  return parsed.data;
}

export const env = validateEnv();

export type Env = typeof env;
