import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  listApplicationsQuerySchema,
  updateApplicationSchema,
  type Application,
  type ListApplicationsQuery,
  type UpdateApplicationInput,
} from '@gigmap/shared';

import { CurrentUser, Roles } from '../../common/decorators';
import { RATE_LIMITS } from '../../config/rate-limits';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** Worker's "My Applications" screen. */
  @Get('mine')
  @Roles('worker')
  findMine(
    @CurrentUser('id') workerId: string,
    @Query(new ZodValidationPipe(listApplicationsQuerySchema)) query: ListApplicationsQuery,
  ): Promise<Application[]> {
    return this.applications.findForWorker(workerId, query);
  }

  @Patch(':id')
  @Roles('employer')
  updateStatus(
    @CurrentUser('id') employerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateApplicationSchema)) body: UpdateApplicationInput,
  ): Promise<Application> {
    return this.applications.updateStatus(employerId, id, body);
  }
}

/** Applications scoped to a job: applying, and the employer's applicant list. */
@Controller('jobs/:jobId/applications')
export class JobApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @Roles('worker')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: RATE_LIMITS.apply })
  apply(
    @CurrentUser('id') workerId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<Application> {
    return this.applications.apply(workerId, jobId);
  }

  @Get()
  @Roles('employer')
  findForJob(
    @CurrentUser('id') employerId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<Application[]> {
    return this.applications.findForJob(employerId, jobId);
  }
}
