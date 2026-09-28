import { PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates a request payload against a schema from `@gigmap/shared` — the
 * same schema the mobile and web forms use, so the client cannot submit
 * something the server was never going to accept.
 *
 * Returns the *parsed* value, so coercions declared in the schema
 * (`z.coerce.number()` on query strings, `z.coerce.date()` on timestamps)
 * reach the handler already converted.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const { fieldErrors, formErrors } = result.error.flatten();
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: formErrors[0] ?? 'Validation failed',
        errors: fieldErrors,
      });
    }

    return result.data;
  }
}
