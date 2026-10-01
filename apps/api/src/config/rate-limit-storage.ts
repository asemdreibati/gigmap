import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { type ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { REDIS } from '../common/redis/redis.module';

type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Where rate-limit counters live (ADR 0014).
 *
 * With Redis configured, counters are shared, so a user's budget holds across
 * every instance. If Redis errors, this instance counts in its own memory for
 * that request instead: limits loosen to per-instance for the duration of the
 * outage, but a rate limiter never takes the API down with it.
 */
@Injectable()
export class RateLimitStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RateLimitStorage.name);
  private readonly local = new ThrottlerStorageService();
  private readonly shared: ThrottlerStorageRedisService | null;
  private lastFallbackWarning = 0;

  constructor(@Inject(REDIS) redis: Redis | null) {
    this.shared = redis ? new ThrottlerStorageRedisService(redis) : null;
  }

  get isShared(): boolean {
    return this.shared !== null;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    if (this.shared) {
      try {
        return await this.shared.increment(key, ttl, limit, blockDuration, throttlerName);
      } catch (error) {
        this.warnFallback(error as Error);
      }
    }

    return this.local.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  onApplicationShutdown(): void {
    // Clears the in-memory store's expiry timers.
    this.local.onApplicationShutdown();
  }

  private warnFallback(error: Error): void {
    if (Date.now() - this.lastFallbackWarning > 60_000) {
      this.lastFallbackWarning = Date.now();
      this.logger.warn(`Rate limiting per instance while Redis fails: ${error.message}`);
    }
  }
}
