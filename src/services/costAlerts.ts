import { env } from '../config/env.js';
import { redis, redisHelpers } from './redis.js';
import { costTracker } from './costTracker.js';
import { logger } from '../utils/logger.js';

const alertLogger = logger.child({ service: 'cost-alerts' });

const ALERT_PREFIX = 'alert:';
const ALERT_COOLDOWN_SECONDS = 60 * 60; // 1 hour between alerts

export interface AlertConfig {
  thresholdCents: number;
  email?: string;
  slackWebhook?: string;
}

export interface AlertPayload {
  type: 'daily_threshold' | 'monthly_threshold' | 'spike';
  currentCostCents: number;
  thresholdCents: number;
  timestamp: string;
  message: string;
}

export const costAlerts = {
  getConfig(): AlertConfig {
    return {
      thresholdCents: env.COST_ALERT_THRESHOLD * 100, // Convert dollars to cents
      email: env.COST_ALERT_EMAIL,
    };
  },

  async checkDailyThreshold(): Promise<boolean> {
    const config = this.getConfig();
    const dailyCost = await costTracker.getDailyCost();

    if (dailyCost >= config.thresholdCents) {
      const alertKey = `${ALERT_PREFIX}daily:${new Date().toISOString().split('T')[0]}`;
      const alreadyAlerted = await redis.get(alertKey);

      if (!alreadyAlerted) {
        await this.sendAlert({
          type: 'daily_threshold',
          currentCostCents: dailyCost,
          thresholdCents: config.thresholdCents,
          timestamp: new Date().toISOString(),
          message: `Daily cost threshold exceeded: $${(dailyCost / 100).toFixed(2)} (threshold: $${(config.thresholdCents / 100).toFixed(2)})`,
        });

        await redis.setex(alertKey, ALERT_COOLDOWN_SECONDS, '1');
        return true;
      }
    }

    return false;
  },

  async sendAlert(payload: AlertPayload): Promise<void> {
    const config = this.getConfig();

    alertLogger.warn({
      ...payload,
    }, 'Cost alert triggered');

    // Log the alert (in production, send to Slack/email)
    if (config.email) {
      alertLogger.info({
        email: config.email,
        payload,
      }, 'Would send email alert');

      // TODO: Implement actual email sending
      // await sendEmail(config.email, 'PharmacyCaller Cost Alert', payload.message);
    }

    // Store alert history
    await redisHelpers.setJson(
      `${ALERT_PREFIX}history:${Date.now()}`,
      payload,
      60 * 60 * 24 * 7 // Keep for 7 days
    );
  },

  async getAlertHistory(limit = 10): Promise<AlertPayload[]> {
    const keys = await redis.keys(`${ALERT_PREFIX}history:*`);
    const sortedKeys = keys.sort().reverse().slice(0, limit);

    const alerts: AlertPayload[] = [];
    for (const key of sortedKeys) {
      const alert = await redisHelpers.getJson<AlertPayload>(key);
      if (alert) {
        alerts.push(alert);
      }
    }

    return alerts;
  },

  async isNearThreshold(percentageWarning = 80): Promise<boolean> {
    const config = this.getConfig();
    const dailyCost = await costTracker.getDailyCost();
    const warningThreshold = (config.thresholdCents * percentageWarning) / 100;

    return dailyCost >= warningThreshold;
  },

  formatCost(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  },
};

// Periodic check (can be called from a cron job or setInterval)
export async function runCostAlertCheck(): Promise<void> {
  try {
    await costAlerts.checkDailyThreshold();
  } catch (error) {
    alertLogger.error({ err: error }, 'Failed to run cost alert check');
  }
}
