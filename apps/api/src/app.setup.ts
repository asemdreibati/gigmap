import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { requestLogging } from './common/http/request-logging';
import type { Env } from './config/env';

/**
 * Everything `main.ts` does to the app besides listening. Shared with the
 * end-to-end tests so they exercise the same prefix, filters and middleware
 * as production rather than a lookalike.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<Env, true>);

  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) {
    app.set('trust proxy', proxyHops);
  }

  app.use(requestLogging());
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  // No global ValidationPipe: every payload is validated by a Zod schema from
  // @gigmap/shared, and path params use ParseUUIDPipe. Registering one here
  // would only drag in class-validator for nothing.
  app.enableShutdownHooks();
}
