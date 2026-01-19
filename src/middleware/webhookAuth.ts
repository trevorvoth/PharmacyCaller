import type { FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import { twilioConfig } from '../config/twilio.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const webhookAuthLogger = logger.child({ service: 'webhook-auth' });

/**
 * Validates Twilio webhook signature
 *
 * Twilio signs all webhook requests with the X-Twilio-Signature header.
 * This middleware validates that signature to ensure the request came from Twilio.
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export async function validateTwilioSignature(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip validation in development mode if explicitly disabled
  if (env.NODE_ENV === 'development' && process.env.SKIP_TWILIO_SIGNATURE === 'true') {
    webhookAuthLogger.warn('Skipping Twilio signature validation in development');
    return;
  }

  const signature = request.headers['x-twilio-signature'];

  if (!signature || typeof signature !== 'string') {
    webhookAuthLogger.warn({
      ip: request.ip,
      url: request.url,
    }, 'Missing Twilio signature header');

    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Missing Twilio signature',
    });
  }

  // Reconstruct the full URL that Twilio signed
  const protocol = request.headers['x-forwarded-proto'] ?? 'http';
  const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? request.hostname;
  const url = `${protocol}://${host}${request.url}`;

  // Get the body parameters
  // Twilio signs the URL + sorted POST parameters
  const params = request.body as Record<string, string> | undefined;

  try {
    const isValid = twilio.validateRequest(
      twilioConfig.authToken,
      signature,
      url,
      params ?? {}
    );

    if (!isValid) {
      webhookAuthLogger.warn({
        ip: request.ip,
        url: request.url,
        signature,
      }, 'Invalid Twilio signature');

      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Invalid Twilio signature',
      });
    }

    webhookAuthLogger.debug({
      url: request.url,
    }, 'Twilio signature validated');
  } catch (error) {
    webhookAuthLogger.error({
      error,
      url: request.url,
    }, 'Error validating Twilio signature');

    return reply.status(500).send({
      error: 'Internal Server Error',
      message: 'Failed to validate webhook signature',
    });
  }
}

/**
 * Validates that a request comes from a known Twilio IP
 * This is an additional layer of security on top of signature validation
 *
 * Note: Twilio's IP ranges can change, so this should be used with caution
 * and with a mechanism to update the allowed IPs
 */
export async function validateTwilioIP(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Twilio's webhook IPs - these should be verified against Twilio's documentation
  // https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides
  const allowedRanges = [
    '54.', // AWS
    '34.', // GCP
  ];

  const clientIP = request.ip;

  // Skip in development
  if (env.NODE_ENV === 'development') {
    return;
  }

  // Check if IP starts with any allowed range
  // This is a simplified check - production should use proper CIDR matching
  const isAllowed = allowedRanges.some((range) => clientIP.startsWith(range)) ||
    clientIP === '127.0.0.1' ||
    clientIP === '::1';

  if (!isAllowed) {
    webhookAuthLogger.warn({
      ip: clientIP,
      url: request.url,
    }, 'Request from unknown IP');

    // Don't reject - just log. Signature validation is the primary security measure
  }
}

/**
 * Combined Twilio webhook authentication
 * Validates both signature and optionally IP
 */
export async function authenticateTwilioWebhook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await validateTwilioIP(request, reply);
  await validateTwilioSignature(request, reply);
}
