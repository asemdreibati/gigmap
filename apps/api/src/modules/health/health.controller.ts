import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { setTimeout as sleep } from 'node:timers/promises';

import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LifecycleService } from './lifecycle.service';

/** Longest a readiness probe waits on the database before calling it down. */
export const DATABASE_CHECK_TIMEOUT_MS = 2000;

export interface HealthStatus {
  status: 'ok' | 'draining' | 'unavailable';
  database?: 'up' | 'down';
}

/**
 * Probes for the platform. Public, never throttled, and outside the `/v1`
 * prefix. See docs/deployment.md#health-checks.
 */
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: LifecycleService,
  ) {}

  /**
   * Liveness: the process is up and its event loop is responsive. Never
   * touches the database, so an outage there cannot make the platform
   * restart every instance in a loop.
   */
  @Get('live')
  live(): HealthStatus {
    return { status: 'ok' };
  }

  /**
   * Readiness: this instance should receive traffic. 503 while shutting down
   * or when the database does not answer within the timeout.
   */
  @Get('ready')
  ready(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    return this.readiness(res);
  }

  /** Kept for existing checks; same contract as `/health/ready`. */
  @Get()
  check(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    return this.readiness(res);
  }

  private async readiness(res: Response): Promise<HealthStatus> {
    if (this.lifecycle.isDraining) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'draining' };
    }

    if (!(await this.databaseResponds())) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unavailable', database: 'down' };
    }

    return { status: 'ok', database: 'up' };
  }

  private async databaseResponds(): Promise<boolean> {
    const timeout = new AbortController();
    try {
      return await Promise.race([
        this.prisma.$queryRaw`SELECT 1`.then(() => true),
        sleep(DATABASE_CHECK_TIMEOUT_MS, false, { signal: timeout.signal }),
      ]);
    } catch {
      return false;
    } finally {
      timeout.abort();
    }
  }
}
