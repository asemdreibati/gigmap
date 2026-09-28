import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ name: z.string().min(2, 'Name is too short'), age: z.coerce.number() }),
  );

  it('returns the parsed value, with coercions applied', () => {
    expect(pipe.transform({ name: 'Ada', age: '36' })).toEqual({ name: 'Ada', age: 36 });
  });

  it('throws a 422 with per-field messages', () => {
    let caught: unknown;
    try {
      pipe.transform({ name: 'A', age: '36' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse()).toEqual({
      statusCode: 422,
      message: 'Validation failed',
      errors: { name: ['Name is too short'] },
    });
  });
});
