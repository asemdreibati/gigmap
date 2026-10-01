import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedUser } from '../guards/authenticated-user';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Ids from upstream (load balancer, client) are reused only if they look sane. */
const ACCEPTABLE_REQUEST_ID = /^[\w.:-]{8,128}$/;

export type RequestWithId = Request & { id: string; user?: AuthenticatedUser };

export function parseRequestId(header: string | undefined): string | null {
  return header && ACCEPTABLE_REQUEST_ID.test(header) ? header : null;
}

/**
 * Tags every request with an id (echoed in `X-Request-Id`, and in error
 * logs) and writes one access-log entry per response.
 *
 * Deliberately logged without the query string: `/v1/jobs/nearby` carries
 * the user's coordinates, which are personal data.
 */
export function requestLogging(logger = new Logger('HTTP')) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const request = req as RequestWithId;
    request.id = parseRequestId(req.get(REQUEST_ID_HEADER)) ?? randomUUID();
    res.setHeader(REQUEST_ID_HEADER, request.id);

    const started = process.hrtime.bigint();

    res.on('finish', () => {
      // Probes run every few seconds per instance; logging them drowns
      // everything else.
      if (req.path.startsWith('/health')) {
        return;
      }

      logger.log({
        requestId: request.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        userId: request.user?.id,
      });
    });

    next();
  };
}
