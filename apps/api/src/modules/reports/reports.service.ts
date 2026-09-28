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
    const ownerId = await this.findOwnerId(input);

    if (!ownerId) {
      throw new BadRequestException('The reported item no longer exists');
    }

    // Each report emails the admin; reports against yourself are only noise.
    if (ownerId === reporterId) {
      throw new BadRequestException(
        input.targetType === 'job'
          ? 'You cannot report your own job'
          : 'You cannot report yourself',
      );
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

  /** Who is answerable for the reported item, or null if it no longer exists. */
  private async findOwnerId({ targetType, targetId }: CreateReportInput): Promise<string | null> {
    if (targetType === 'job') {
      const job = await this.prisma.job.findUnique({
        where: { id: targetId },
        select: { employerId: true },
      });
      return job?.employerId ?? null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    return user?.id ?? null;
  }
}
