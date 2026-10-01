import { type BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Env } from '../../config/env';

/**
 * Tracks whether this instance is shutting down, so the readiness probe can
 * tell the load balancer to stop sending traffic *before* the HTTP server
 * closes.
 *
 * Nest's shutdown order is: `beforeApplicationShutdown` (this) → HTTP server
 * close, which waits for in-flight requests → `onApplicationShutdown` (push
 * flush, Prisma disconnect). See ADR 0012.
 */
@Injectable()
export class LifecycleService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(LifecycleService.name);
  private readonly drainMs: number;
  private draining = false;

  constructor(config: ConfigService<Env, true>) {
    this.drainMs = config.get('SHUTDOWN_DRAIN_MS', { infer: true });
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /** Fail readiness from now on. Idempotent. */
  beginDrain(): void {
    this.draining = true;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.beginDrain();
    this.logger.log(`Received ${signal ?? 'shutdown'}; draining for ${this.drainMs} ms`);
    // Give the load balancer time to see the failing probe and stop routing
    // here. Requests that still arrive are served normally.
    await sleep(this.drainMs);
  }
}
