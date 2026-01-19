import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pharmacySearchService } from '../services/pharmacySearch.js';
import { checkSearchLimit, incrementSearchCount } from '../middleware/userLimits.js';
import { metrics, METRICS } from '../services/metrics.js';

const searchQuerySchema = z.object({
  latitude: z.string().transform((val) => {
    const num = parseFloat(val);
    if (isNaN(num) || num < -90 || num > 90) {
      throw new Error('Invalid latitude');
    }
    return num;
  }),
  longitude: z.string().transform((val) => {
    const num = parseFloat(val);
    if (isNaN(num) || num < -180 || num > 180) {
      throw new Error('Invalid longitude');
    }
    return num;
  }),
  radius: z.string().optional().transform((val) => {
    if (!val) {
      return undefined;
    }
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 1000 || num > 50000) {
      throw new Error('Radius must be between 1000 and 50000 meters');
    }
    return num;
  }),
  limit: z.string().optional().transform((val) => {
    if (!val) {
      return undefined;
    }
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 1 || num > 20) {
      throw new Error('Limit must be between 1 and 20');
    }
    return num;
  }),
});

export async function pharmacyRoutes(app: FastifyInstance): Promise<void> {
  // GET /pharmacies/search - Search for nearby pharmacies
  app.get('/pharmacies/search', {
    preHandler: [app.authenticate, checkSearchLimit],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = searchQuerySchema.safeParse(request.query);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid query parameters',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { latitude, longitude, radius, limit } = parseResult.data;
    const userId = request.user?.userId;

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const results = await pharmacySearchService.searchNearby({
        latitude,
        longitude,
        radiusMeters: radius,
        maxResults: limit,
      });

      // Increment user's search count
      await incrementSearchCount(userId);
      await metrics.increment(METRICS.SEARCHES_STARTED);

      return reply.status(200).send({
        results,
        count: results.length,
        location: { latitude, longitude },
        radiusMeters: radius ?? 16093,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('API key')) {
        return reply.status(503).send({
          error: 'Pharmacy search unavailable',
          message: 'Unable to search for pharmacies at this time. Please try again later.',
        });
      }
      throw error;
    }
  });
}
