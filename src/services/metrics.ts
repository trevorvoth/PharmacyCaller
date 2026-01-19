import { redis } from './redis.js';
import { logger } from '../utils/logger.js';

const METRICS_PREFIX = 'metrics:';
const DAILY_KEY_TTL = 60 * 60 * 25; // 25 hours (to cover timezone variations)

type MetricType = 'counter' | 'gauge';

interface MetricDefinition {
  name: string;
  type: MetricType;
  description: string;
}

// Define all metrics
export const METRICS: Record<string, MetricDefinition> = {
  // Call metrics
  CALL_COUNT: { name: 'call_count', type: 'counter', description: 'Total calls received' },
  CALLS_INITIATED: { name: 'calls_initiated', type: 'counter', description: 'Total calls initiated' },
  CALLS_COMPLETED: { name: 'calls_completed', type: 'counter', description: 'Total calls completed' },
  CALLS_FAILED: { name: 'calls_failed', type: 'counter', description: 'Total calls failed' },
  CALLS_CONNECTED: { name: 'calls_connected', type: 'counter', description: 'Calls where patient connected' },
  CALL_SUCCESS: { name: 'call_success', type: 'counter', description: 'Successful call completions' },
  CALL_FAILED: { name: 'call_failed', type: 'counter', description: 'Failed call attempts' },

  // IVR metrics
  IVR_SUCCESS: { name: 'ivr_success', type: 'counter', description: 'Successful IVR navigations' },
  IVR_FAILED: { name: 'ivr_failed', type: 'counter', description: 'Failed IVR navigations' },

  // Detection metrics
  HUMAN_DETECTED: { name: 'human_detected', type: 'counter', description: 'Times human pharmacist detected' },
  VOICEMAIL_DETECTED: { name: 'voicemail_detected', type: 'counter', description: 'Times voicemail detected' },

  // Search metrics
  SEARCHES_STARTED: { name: 'searches_started', type: 'counter', description: 'Total searches started' },
  SEARCHES_COMPLETED: { name: 'searches_completed', type: 'counter', description: 'Searches completed' },
  MEDICATION_FOUND: { name: 'medication_found', type: 'counter', description: 'Times medication was found' },

  // User metrics
  ACTIVE_USERS: { name: 'active_users', type: 'gauge', description: 'Currently active users' },
  USERS_REGISTERED: { name: 'users_registered', type: 'counter', description: 'Total users registered' },

  // Cost metrics
  DAILY_COST: { name: 'daily_cost', type: 'gauge', description: 'Total cost today (cents)' },
  CALL_DURATION: { name: 'call_duration', type: 'counter', description: 'Total call duration (seconds)' },

  // Error metrics
  ERRORS_TOTAL: { name: 'errors_total', type: 'counter', description: 'Total errors' },
  WEBHOOK_ERRORS: { name: 'webhook_errors', type: 'counter', description: 'Webhook processing errors' },
};

function getDailyKey(metric: string): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${METRICS_PREFIX}daily:${date}:${metric}`;
}

function getTotalKey(metric: string): string {
  return `${METRICS_PREFIX}total:${metric}`;
}

export const metrics = {
  async increment(metric: MetricDefinition, value = 1, labels?: Record<string, string>): Promise<void> {
    try {
      const labelSuffix = labels ? `:${Object.values(labels).join(':')}` : '';
      const dailyKey = getDailyKey(metric.name + labelSuffix);
      const totalKey = getTotalKey(metric.name + labelSuffix);

      await Promise.all([
        redis.incrby(dailyKey, value),
        redis.expire(dailyKey, DAILY_KEY_TTL),
        redis.incrby(totalKey, value),
      ]);

      logger.debug({ metric: metric.name, value, labels }, 'Metric incremented');
    } catch (error) {
      logger.error({ err: error, metric: metric.name }, 'Failed to increment metric');
    }
  },

  async set(metric: MetricDefinition, value: number, labels?: Record<string, string>): Promise<void> {
    try {
      const labelSuffix = labels ? `:${Object.values(labels).join(':')}` : '';
      const dailyKey = getDailyKey(metric.name + labelSuffix);

      await redis.set(dailyKey, value.toString());
      await redis.expire(dailyKey, DAILY_KEY_TTL);

      logger.debug({ metric: metric.name, value, labels }, 'Metric set');
    } catch (error) {
      logger.error({ err: error, metric: metric.name }, 'Failed to set metric');
    }
  },

  async get(metric: MetricDefinition, labels?: Record<string, string>): Promise<number> {
    try {
      const labelSuffix = labels ? `:${Object.values(labels).join(':')}` : '';
      const dailyKey = getDailyKey(metric.name + labelSuffix);
      const value = await redis.get(dailyKey);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      logger.error({ err: error, metric: metric.name }, 'Failed to get metric');
      return 0;
    }
  },

  async getTotal(metric: MetricDefinition, labels?: Record<string, string>): Promise<number> {
    try {
      const labelSuffix = labels ? `:${Object.values(labels).join(':')}` : '';
      const totalKey = getTotalKey(metric.name + labelSuffix);
      const value = await redis.get(totalKey);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      logger.error({ err: error, metric: metric.name }, 'Failed to get total metric');
      return 0;
    }
  },

  async getDailyStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};

    for (const [key, metric] of Object.entries(METRICS)) {
      stats[key] = await this.get(metric);
    }

    return stats;
  },

  async recordCallCost(costCents: number): Promise<void> {
    await this.increment(METRICS.DAILY_COST, costCents);
  },

  async recordCallDuration(durationSeconds: number): Promise<void> {
    await this.increment(METRICS.CALL_DURATION, durationSeconds);
  },
};

export type Metrics = typeof metrics;
