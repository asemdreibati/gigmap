import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createJobSchema,
  nearbyJobsQuerySchema,
  updateJobSchema,
  updateJobStatusSchema,
  type CreateJobInput,
  type Job,
  type NearbyJob,
  type NearbyJobsQuery,
  type UpdateJobInput,
  type UpdateJobStatusInput,
} from '@gigmap/shared';

import { CurrentUser, Roles } from '../../common/decorators';
import { RATE_LIMITS } from '../../config/rate-limits';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Powers both the map and the list view — same data, different presentation. */
  @Get('nearby')
  findNearby(
    @Query(new ZodValidationPipe(nearbyJobsQuerySchema)) query: NearbyJobsQuery,
  ): Promise<NearbyJob[]> {
    return this.jobs.findNearby(query);
  }

  // Declared before `:id` so the literal path wins the route match.
  @Get('mine')
  @Roles('employer')
  findMine(@CurrentUser('id') employerId: string): Promise<Job[]> {
    return this.jobs.findByEmployer(employerId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Job> {
    return this.jobs.findOne(id);
  }

  @Post()
  @Roles('employer')
  @Throttle({ default: RATE_LIMITS.postJob })
  create(
    @CurrentUser('id') employerId: string,
    @Body(new ZodValidationPipe(createJobSchema)) body: CreateJobInput,
  ): Promise<Job> {
    return this.jobs.create(employerId, body);
  }

  @Patch(':id')
  @Roles('employer')
  update(
    @CurrentUser('id') employerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateJobSchema)) body: UpdateJobInput,
  ): Promise<Job> {
    return this.jobs.update(employerId, id, body);
  }

  @Patch(':id/status')
  @Roles('employer')
  updateStatus(
    @CurrentUser('id') employerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateJobStatusSchema)) body: UpdateJobStatusInput,
  ): Promise<Job> {
    return this.jobs.updateStatus(employerId, id, body);
  }
}
