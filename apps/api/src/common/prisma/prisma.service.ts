import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { type Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: logLevels(process.env['NODE_ENV']),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  /**
   * Not `onModuleDestroy`: Nest runs that before the HTTP server closes, which
   * would pull the connection pool out from under requests still in flight
   * during a rolling deploy. By this hook the server has drained.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Prisma logs every failed query at `error`, including the unique-violation
 * errors services catch and turn into 409s. Tests exercise those paths on
 * purpose, so keep their output clean.
 */
function logLevels(nodeEnv: string | undefined): Prisma.LogLevel[] {
  if (nodeEnv === 'test') {
    return [];
  }
  return nodeEnv === 'development' ? ['warn', 'error'] : ['error'];
}
