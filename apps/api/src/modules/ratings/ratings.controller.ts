import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  createRatingSchema,
  type CreateRatingInput,
  type PendingRating,
  type Rating,
} from '@gigmap/shared';

import { CurrentUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/guards/authenticated-user';
import { RatingsService } from './ratings.service';

@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  /** Ratings the current user is still able to leave. Drives the rating prompt. */
  @Get('pending')
  findPending(@CurrentUser() auth: AuthenticatedUser): Promise<PendingRating[]> {
    return this.ratings.findPending(auth);
  }

  @Post()
  create(
    @CurrentUser() auth: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRatingSchema)) body: CreateRatingInput,
  ): Promise<Rating> {
    return this.ratings.create(auth, body);
  }
}
