import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  // No global ValidationPipe: every payload is validated by a Zod schema from
  // @gigmap/shared, and path params use ParseUUIDPipe. Registering one here
  // would only drag in class-validator for nothing.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  Logger.log(`GigMap API listening on http://localhost:${port}/v1`, 'Bootstrap');
}

void bootstrap();
