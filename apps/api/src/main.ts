import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './config/env';
import { createLogger } from './config/logger';

async function bootstrap(): Promise<void> {
  // Logs are buffered until the validated config says how to format them.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);
  app.useLogger(
    createLogger({
      LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
      LOG_FORMAT: config.get('LOG_FORMAT', { infer: true }),
    }),
  );
  configureApp(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  Logger.log(`GigMap API listening on http://localhost:${port}/v1`, 'Bootstrap');
}

void bootstrap();
