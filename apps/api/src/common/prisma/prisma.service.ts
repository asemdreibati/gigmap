import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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

  async onModuleDestroy(): Promise<void> {
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
