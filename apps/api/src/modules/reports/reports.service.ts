import { BadRequestException, Injectable } from '@nestjs/common';
import type { CreateReportInput, Report } from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

/**
 * v1 has no moderation queue: jobs publish immediately and reports are the
 * safety valve. Each one is persisted and emailed to the admin, who acts on it
 * through Supabase Studio.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async create(reporterId: string, input: CreateReportInput): Promise<Report> {
    const exists =
      input.targetType === 'job'
        ? await this.prisma.job.findUnique({ where: { id: input.targetId }, select: { id: true } })
        : await this.prisma.user.findUnique({
            where: { id: input.targetId },
            select: { id: true },
          });

    if (!exists) {
      throw new BadRequestException('The reported item no longer exists');
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      },
    });

    void this.email.sendToAdmin(
      `[GigMap] ${input.targetType} reported`,
      [
        `Report id:  ${report.id}`,
        `Target:     ${input.targetType} ${input.targetId}`,
        `Reporter:   ${reporterId}`,
        `Filed at:   ${report.createdAt.toISOString()}`,
        '',
        'Reason:',
        input.reason,
      ].join('\n'),
    );

    return {
      id: report.id,
      reporterId: report.reporterId,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      createdAt: report.createdAt.toISOString(),
    };
  }
}
