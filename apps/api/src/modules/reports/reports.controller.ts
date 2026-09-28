import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createReportSchema, type CreateReportInput, type Report } from '@gigmap/shared';

import { CurrentUser } from '../../common/decorators';
import { RATE_LIMITS } from '../../config/rate-limits';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Throttle({ default: RATE_LIMITS.reports })
  create(
    @CurrentUser('id') reporterId: string,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportInput,
  ): Promise<Report> {
    return this.reports.create(reporterId, body);
  }
}
