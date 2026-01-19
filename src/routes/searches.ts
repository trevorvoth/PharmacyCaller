import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { callOrchestrator } from '../services/callOrchestrator.js';
import { pharmacyTracker } from '../services/pharmacyTracker.js';
import { pharmacySearchService, type PharmacySearchResult } from '../services/pharmacySearch.js';
import { checkSearchLimit } from '../middleware/userLimits.js';
import { metrics, METRICS } from '../services/metrics.js';

const searchLogger = logger.child({ service: 'searches-routes' });

const StartSearchSchema = z.object({
  medicationQuery: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().min(1000).max(50000).optional().default(8000),
  maxPharmacies: z.number().min(1).max(10).optional().default(3),
});

const MarkFoundSchema = z.object({
  pharmacyId: z.string(),
});

const MarkNotFoundSchema = z.object({
  pharmacyId: z.string(),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /searches
   * Task 6.2: Start a new pharmacy search
   */
  app.post(
    '/searches',
    {
      preHandler: [app.authenticate, checkSearchLimit],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const parseResult = StartSearchSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const { medicationQuery, latitude, longitude, radiusMeters, maxPharmacies } = parseResult.data;

      searchLogger.info({
        userId: user.userId,
        medicationQuery,
        latitude,
        longitude,
      }, 'Starting pharmacy search');

      try {
        // Find nearby pharmacies
        const pharmacies = await pharmacySearchService.searchNearby({
          latitude,
          longitude,
          radiusMeters,
          maxResults: maxPharmacies * 2, // Get extra in case some fail
        });

        if (pharmacies.length === 0) {
          return reply.status(404).send({
            error: 'No pharmacies found',
            message: 'No pharmacies found in your area. Try increasing the search radius.',
          });
        }

        // Create search record in database
        const search = await prisma.pharmacySearch.create({
          data: {
            userId: user.userId,
            medicationQuery,
            latitude,
            longitude,
          },
        });

        // Create pharmacy result records
        const pharmacyResults = await Promise.all(
          pharmacies.slice(0, maxPharmacies).map((p: PharmacySearchResult) =>
            prisma.pharmacyResult.create({
              data: {
                searchId: search.id,
                pharmacyName: p.name,
                address: p.address,
                phone: p.phone,
                latitude: p.latitude,
                longitude: p.longitude,
                placeId: p.id,
                chain: p.chain,
              },
            })
          )
        );

        // Initialize tracker
        await pharmacyTracker.initSearch({
          searchId: search.id,
          userId: user.userId,
          medicationQuery,
          pharmacyResults: pharmacyResults.map((p) => ({
            id: p.id,
            pharmacyName: p.pharmacyName,
            address: p.address,
            phone: p.phone,
          })),
        });

        // Start parallel calls
        await callOrchestrator.startSearch({
          userId: user.userId,
          searchId: search.id,
          medicationQuery,
          pharmacies: pharmacyResults.map((p) => ({
            id: p.id,
            name: p.pharmacyName,
            phoneNumber: p.phone,
            address: p.address,
          })),
        });

        // Update user's daily search count
        await prisma.user.update({
          where: { id: user.userId },
          data: {
            dailySearchCount: { increment: 1 },
            lastSearchDate: new Date(),
          },
        });

        // Track metric
        const searchMetric = METRICS.SEARCHES_STARTED;
        if (searchMetric) {
          await metrics.increment(searchMetric);
        }

        return reply.status(201).send({
          searchId: search.id,
          medicationQuery,
          pharmacies: pharmacyResults.map((p) => ({
            id: p.id,
            name: p.pharmacyName,
            address: p.address,
            phone: p.phone,
            chain: p.chain,
          })),
          message: `Calling ${pharmacyResults.length} pharmacies...`,
        });
      } catch (error) {
        searchLogger.error({ err: error, userId: user.userId }, 'Failed to start search');
        return reply.status(500).send({
          error: 'Failed to start search',
          message: 'An error occurred while starting your search. Please try again.',
        });
      }
    }
  );

  /**
   * GET /searches/:id
   * Task 6.3: Get search status
   */
  app.get(
    '/searches/:id',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const search = await prisma.pharmacySearch.findUnique({
        where: { id },
        include: {
          results: true,
        },
      });

      if (!search) {
        return reply.status(404).send({ error: 'Search not found' });
      }

      if (search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Get real-time status from tracker
      const summary = await pharmacyTracker.getSearchSummary(id);
      const checklist = await pharmacyTracker.getChecklist(id);

      return reply.send({
        id: search.id,
        medicationQuery: search.medicationQuery,
        status: summary?.status ?? search.status,
        createdAt: search.createdAt,
        completedAt: search.completedAt,
        foundAt: summary?.foundAt,
        activeCalls: summary?.activeCalls ?? 0,
        readyCalls: summary?.readyCalls ?? 0,
        pharmacies: checklist,
      });
    }
  );

  /**
   * POST /searches/:id/found
   * Task 6.4: Mark medication as found
   */
  app.post(
    '/searches/:id/found',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const parseResult = MarkFoundSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const { pharmacyId } = parseResult.data;

      const search = await prisma.pharmacySearch.findUnique({
        where: { id },
      });

      if (!search) {
        return reply.status(404).send({ error: 'Search not found' });
      }

      if (search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      await pharmacyTracker.markMedicationFound(id, pharmacyId);

      searchLogger.info({
        searchId: id,
        pharmacyId,
        userId: user.userId,
      }, 'Medication marked as found');

      return reply.send({
        success: true,
        message: 'Great! Search completed - all other calls have been ended.',
      });
    }
  );

  /**
   * POST /searches/:id/cancel
   * Cancel a search
   */
  app.post(
    '/searches/:id/cancel',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const search = await prisma.pharmacySearch.findUnique({
        where: { id },
      });

      if (!search) {
        return reply.status(404).send({ error: 'Search not found' });
      }

      if (search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      await pharmacyTracker.cancelSearch(id);

      return reply.send({
        success: true,
        message: 'Search cancelled - all calls have been ended.',
      });
    }
  );

  /**
   * POST /pharmacies/:id/not-found
   * Task 6.5: Mark medication as NOT found at a pharmacy
   */
  app.post(
    '/pharmacies/:id/not-found',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const pharmacy = await prisma.pharmacyResult.findUnique({
        where: { id },
        include: {
          search: true,
        },
      });

      if (!pharmacy) {
        return reply.status(404).send({ error: 'Pharmacy not found' });
      }

      if (pharmacy.search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      await pharmacyTracker.markMedicationNotFound(pharmacy.searchId, id);

      return reply.send({
        success: true,
        message: `Noted - ${pharmacy.pharmacyName} didn't have it.`,
      });
    }
  );

  /**
   * GET /searches/:id/queue
   * Task 6.8: Get the call queue for a search
   */
  app.get(
    '/searches/:id/queue',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const search = await prisma.pharmacySearch.findUnique({
        where: { id },
      });

      if (!search) {
        return reply.status(404).send({ error: 'Search not found' });
      }

      if (search.userId !== user.userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const readyPharmacies = await pharmacyTracker.getReadyPharmacies(id);

      return reply.send({
        queue: readyPharmacies.map((p) => ({
          callId: p.callId,
          pharmacyId: p.pharmacyId,
          pharmacyName: p.pharmacyName,
          isHumanReady: p.isHumanReady,
          isVoicemailReady: p.isVoicemailReady,
        })),
      });
    }
  );

  /**
   * GET /searches
   * Get user's search history
   */
  app.get(
    '/searches',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;

      const searches = await prisma.pharmacySearch.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          results: {
            select: {
              id: true,
              pharmacyName: true,
              callStatus: true,
              hasMedication: true,
            },
          },
        },
      });

      return reply.send({
        searches: searches.map((s) => ({
          id: s.id,
          medicationQuery: s.medicationQuery,
          status: s.status,
          createdAt: s.createdAt,
          completedAt: s.completedAt,
          pharmacyCount: s.results.length,
          foundCount: s.results.filter((r) => r.hasMedication === true).length,
        })),
      });
    }
  );
}
