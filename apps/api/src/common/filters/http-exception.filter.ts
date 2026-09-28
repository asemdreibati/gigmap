import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ApiError } from '@gigmap/shared';

/**
 * Normalises every error into the `ApiError` shape the clients expect, and
 * makes sure an unhandled exception never leaks a stack trace or a database
 * message to the caller.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toApiError(exception);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, message: payload };
    }

    const record = payload as Record<string, unknown>;
    const rawMessage = record['message'];

    return {
      statusCode,
      message: Array.isArray(rawMessage)
        ? String(rawMessage[0])
        : typeof rawMessage === 'string'
          ? rawMessage
          : exception.message,
      ...(record['errors'] ? { errors: record['errors'] as Record<string, string[]> } : {}),
    };
  }
}
