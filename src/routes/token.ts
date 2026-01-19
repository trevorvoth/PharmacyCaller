import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateAccessToken } from '../services/twilio/client.js';
import { logger } from '../utils/logger.js';

const tokenLogger = logger.child({ service: 'token-routes' });

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /token
   * Task 6.10: Generate Twilio Client access token for WebRTC
   *
   * Returns a short-lived access token that allows the client
   * to connect to Twilio's Voice SDK and join conferences.
   */
  app.get(
    '/token',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;

      tokenLogger.info({
        userId: user.userId,
      }, 'Generating Twilio access token');

      try {
        // Use user ID as the identity for the token
        // This ensures each user gets a unique device identity
        const identity = `user-${user.userId}`;
        const token = generateAccessToken(identity);

        tokenLogger.debug({
          userId: user.userId,
          identity,
        }, 'Twilio access token generated');

        return reply.send({
          token,
          identity,
          // Token is valid for 1 hour by default
          expiresIn: 3600,
        });
      } catch (error) {
        tokenLogger.error({
          err: error,
          userId: user.userId,
        }, 'Failed to generate Twilio access token');

        return reply.status(500).send({
          error: 'Token generation failed',
          message: 'Failed to generate voice token. Please try again.',
        });
      }
    }
  );
}
