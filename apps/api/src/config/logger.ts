import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import type { Env } from './env';

/** Nest's levels, most verbose first. */
const LEVELS: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

/** Every level at or above `minimum`. */
export function levelsFrom(minimum: LogLevel): LogLevel[] {
  return LEVELS.slice(LEVELS.indexOf(minimum));
}

/**
 * JSON lines in production, so the platform's log pipeline can index
 * fields (level, context, requestId…) instead of grepping text. Readable,
 * coloured output in development.
 */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'LOG_FORMAT'>): ConsoleLogger {
  const json = env.LOG_FORMAT === 'json';
  return new ConsoleLogger({
    json,
    colors: !json,
    logLevels: levelsFrom(env.LOG_LEVEL),
  });
}
