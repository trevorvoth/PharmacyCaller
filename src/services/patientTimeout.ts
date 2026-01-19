import { redis, redisHelpers } from './redis.js';
import { logger } from '../utils/logger.js';
import { callQueue } from './callQueue.js';
import { callStateMachine } from './callStateMachine.js';
import { CallState } from '../types/callStates.js';
import { EventEmitter } from 'events';

const timeoutLogger = logger.child({ service: 'patient-timeout' });

const TIMEOUT_PREFIX = 'timeout:';
const DEFAULT_TIMEOUT_MS = 60 * 1000; // 60 seconds
const CHECK_INTERVAL_MS = 5 * 1000; // Check every 5 seconds

export interface TimeoutEntry {
  searchId: string;
  callId: string;
  pharmacyName: string;
  notifiedAt: number;
  expiresAt: number;
}

export interface PatientTimeoutEvents {
  timeout: (entry: TimeoutEntry) => void;
  acknowledged: (searchId: string, callId: string) => void;
}

class PatientTimeout extends EventEmitter {
  private checkIntervalId: NodeJS.Timeout | null = null;
  private timeoutMs: number = DEFAULT_TIMEOUT_MS;

  /**
   * Sets the timeout duration
   */
  setTimeoutDuration(ms: number): void {
    this.timeoutMs = ms;
  }

  /**
   * Starts a timeout for a patient to acknowledge a human-ready notification
   */
  async startTimeout(searchId: string, callId: string, pharmacyName: string): Promise<void> {
    const now = Date.now();
    const entry: TimeoutEntry = {
      searchId,
      callId,
      pharmacyName,
      notifiedAt: now,
      expiresAt: now + this.timeoutMs,
    };

    const key = `${TIMEOUT_PREFIX}${searchId}:${callId}`;
    await redisHelpers.setJson(key, entry, Math.ceil(this.timeoutMs / 1000) + 60); // TTL slightly longer than timeout

    timeoutLogger.info({
      searchId,
      callId,
      pharmacyName,
      expiresAt: entry.expiresAt,
      timeoutSeconds: this.timeoutMs / 1000,
    }, 'Patient acknowledgment timeout started');
  }

  /**
   * Cancels a timeout when patient acknowledges
   */
  async acknowledge(searchId: string, callId: string): Promise<void> {
    const key = `${TIMEOUT_PREFIX}${searchId}:${callId}`;
    await redis.del(key);

    timeoutLogger.info({
      searchId,
      callId,
    }, 'Patient acknowledgment received - timeout cancelled');

    this.emit('acknowledged', searchId, callId);
  }

  /**
   * Checks if a specific timeout has expired
   */
  async isExpired(searchId: string, callId: string): Promise<boolean> {
    const key = `${TIMEOUT_PREFIX}${searchId}:${callId}`;
    const entry = await redisHelpers.getJson<TimeoutEntry>(key);

    if (!entry) {
      return false; // Already handled or doesn't exist
    }

    return Date.now() > entry.expiresAt;
  }

  /**
   * Gets all active timeouts for a search
   */
  async getActiveTimeouts(searchId: string): Promise<TimeoutEntry[]> {
    const pattern = `${TIMEOUT_PREFIX}${searchId}:*`;
    const keys = await redis.keys(pattern);
    const entries: TimeoutEntry[] = [];

    for (const key of keys) {
      const entry = await redisHelpers.getJson<TimeoutEntry>(key);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Handles an expired timeout - cancels all calls for the search
   */
  async handleExpiredTimeout(entry: TimeoutEntry): Promise<void> {
    timeoutLogger.warn({
      searchId: entry.searchId,
      callId: entry.callId,
      pharmacyName: entry.pharmacyName,
    }, 'Patient acknowledgment timeout expired - cancelling calls');

    // Emit timeout event
    this.emit('timeout', entry);

    // End all calls for this search
    await callQueue.endAllCalls(entry.searchId);

    // Clear the timeout entry
    const key = `${TIMEOUT_PREFIX}${entry.searchId}:${entry.callId}`;
    await redis.del(key);
  }

  /**
   * Checks all timeouts and handles expired ones
   */
  async checkTimeouts(): Promise<void> {
    const pattern = `${TIMEOUT_PREFIX}*`;
    const keys = await redis.keys(pattern);

    for (const key of keys) {
      const entry = await redisHelpers.getJson<TimeoutEntry>(key);

      if (entry && Date.now() > entry.expiresAt) {
        await this.handleExpiredTimeout(entry);
      }
    }
  }

  /**
   * Starts the background timeout checker
   */
  startChecker(): void {
    if (this.checkIntervalId) {
      return; // Already running
    }

    timeoutLogger.info({ intervalMs: CHECK_INTERVAL_MS }, 'Starting timeout checker');

    this.checkIntervalId = setInterval(() => {
      this.checkTimeouts().catch((error) => {
        timeoutLogger.error({ err: error }, 'Error checking timeouts');
      });
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stops the background timeout checker
   */
  stopChecker(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      timeoutLogger.info('Timeout checker stopped');
    }
  }

  /**
   * Gets remaining time for a timeout
   */
  async getRemainingTime(searchId: string, callId: string): Promise<number | null> {
    const key = `${TIMEOUT_PREFIX}${searchId}:${callId}`;
    const entry = await redisHelpers.getJson<TimeoutEntry>(key);

    if (!entry) {
      return null;
    }

    const remaining = entry.expiresAt - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Extends a timeout by a certain duration
   */
  async extendTimeout(searchId: string, callId: string, extensionMs: number): Promise<void> {
    const key = `${TIMEOUT_PREFIX}${searchId}:${callId}`;
    const entry = await redisHelpers.getJson<TimeoutEntry>(key);

    if (!entry) {
      return;
    }

    entry.expiresAt += extensionMs;
    const newTtl = Math.ceil((entry.expiresAt - Date.now()) / 1000) + 60;
    await redisHelpers.setJson(key, entry, newTtl);

    timeoutLogger.info({
      searchId,
      callId,
      newExpiresAt: entry.expiresAt,
      extensionMs,
    }, 'Timeout extended');
  }

  /**
   * Clears all timeouts for a search
   */
  async clearAllTimeouts(searchId: string): Promise<void> {
    const pattern = `${TIMEOUT_PREFIX}${searchId}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length > 0) {
      await redis.del(...keys);
    }

    timeoutLogger.debug({ searchId, count: keys.length }, 'All timeouts cleared for search');
  }
}

export const patientTimeout = new PatientTimeout();
