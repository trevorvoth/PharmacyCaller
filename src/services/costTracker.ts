import { prisma } from '../db/client.js';
import { redis, redisHelpers } from './redis.js';
import { metrics, METRICS } from './metrics.js';
import { logger } from '../utils/logger.js';

const costLogger = logger.child({ service: 'cost-tracker' });

// Cost rates (in cents per minute)
const COST_RATES = {
  twilio: {
    outbound: 1.4, // $0.014/min
    conference: 0.25, // $0.0025/participant/min
  },
  openai: {
    realtime: 6, // ~$0.06/min for audio
  },
};

const COST_PREFIX = 'cost:';

export interface CallCostBreakdown {
  twilioOutbound: number; // cents
  twilioConference: number; // cents
  openaiRealtime: number; // cents
  total: number; // cents
}

export interface DailyCostSummary {
  date: string;
  totalCents: number;
  callCount: number;
  averageCostPerCall: number;
}

export const costTracker = {
  calculateCallCost(
    durationSeconds: number,
    conferenceSeconds: number = 0,
    aiMinutes: number = 0
  ): CallCostBreakdown {
    const durationMinutes = durationSeconds / 60;
    const conferenceMinutes = conferenceSeconds / 60;

    const twilioOutbound = Math.ceil(durationMinutes * COST_RATES.twilio.outbound);
    const twilioConference = Math.ceil(conferenceMinutes * COST_RATES.twilio.conference);
    const openaiRealtime = Math.ceil(aiMinutes * COST_RATES.openai.realtime);

    return {
      twilioOutbound,
      twilioConference,
      openaiRealtime,
      total: twilioOutbound + twilioConference + openaiRealtime,
    };
  },

  async recordCallCost(callId: string, costCents: number, durationSeconds: number): Promise<void> {
    costLogger.info({ callId, costCents, durationSeconds }, 'Recording call cost');

    try {
      // Update call record
      await prisma.call.update({
        where: { id: callId },
        data: {
          cost: costCents / 100, // Store as dollars
          duration: durationSeconds,
        },
      });

      // Update metrics
      await metrics.recordCallCost(costCents);
      await metrics.recordCallDuration(durationSeconds);

      // Update daily total in Redis
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `${COST_PREFIX}daily:${today}`;

      await redis.incrby(dailyKey, costCents);
      await redis.expire(dailyKey, 60 * 60 * 48); // Keep for 48 hours

      costLogger.info({ callId, costCents }, 'Call cost recorded');
    } catch (error) {
      costLogger.error({ err: error, callId }, 'Failed to record call cost');
    }
  },

  async getDailyCost(date?: string): Promise<number> {
    const targetDate = date ?? new Date().toISOString().split('T')[0];
    const dailyKey = `${COST_PREFIX}daily:${targetDate}`;

    const value = await redis.get(dailyKey);
    return value ? parseInt(value, 10) : 0;
  },

  async getDailyCostSummary(date?: string): Promise<DailyCostSummary> {
    const targetDate = date ?? new Date().toISOString().split('T')[0]!;
    const startOfDay = new Date(targetDate + 'T00:00:00Z');
    const endOfDay = new Date(targetDate + 'T23:59:59Z');

    const [totalCents, calls] = await Promise.all([
      this.getDailyCost(targetDate),
      prisma.call.count({
        where: {
          createdAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      }),
    ]);

    return {
      date: targetDate,
      totalCents,
      callCount: calls,
      averageCostPerCall: calls > 0 ? totalCents / calls : 0,
    };
  },

  async getUserDailyCost(userId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const userKey = `${COST_PREFIX}user:${userId}:${today}`;

    const value = await redis.get(userKey);
    return value ? parseInt(value, 10) : 0;
  },

  async recordUserCost(userId: string, costCents: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const userKey = `${COST_PREFIX}user:${userId}:${today}`;

    await redis.incrby(userKey, costCents);
    await redis.expire(userKey, 60 * 60 * 48);
  },

  async getMonthlySpend(): Promise<number> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Get all calls from this month
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

    const result = await prisma.call.aggregate({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        cost: true,
      },
    });

    return Math.round((result._sum.cost ?? 0) * 100); // Convert to cents
  },
};
