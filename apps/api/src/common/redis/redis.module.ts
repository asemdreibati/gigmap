import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { Env } from '../../config/env';

/** The shared Redis client, or null when REDIS_URL is not configured. */
export const REDIS = Symbol('REDIS');

/**
 * Tuned for a cache-like dependency the API must survive losing: commands
 * fail fast while disconnected instead of queueing, so callers can fall
 * back immediately rather than hang a request.
 */
export function createRedisClient(url: string, logger = new Logger('Redis')): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 500,
  });

  let lastError = 0;
  client.on('error', (error: Error) => {
    // ioredis emits on every reconnect attempt; once a minute is plenty.
    if (Date.now() - lastError > 60_000) {
      lastError = Date.now();
      logger.warn(`Redis unavailable: ${error.message}`);
    }
  });

  return client;
}

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis | null => {
        const url = config.get('REDIS_URL', { infer: true });
        return url ? createRedisClient(url) : null;
      },
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
