import { Body, Controller, Post } from '@nestjs/common';
import { createReportSchema, type CreateReportInput, type Report } from '@gigmap/shared';

import { CurrentUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  create(
    @CurrentUser('id') reporterId: string,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportInput,
  ): Promise<Report> {
    return this.reports.create(reporterId, body);
  }
}
