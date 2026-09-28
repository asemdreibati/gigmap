import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DEFAULT_TIMEZONE } from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { rejectPendingApplications } from '../applications/application-closure';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Scheduled work that used to need pg_cron. Running it in-process keeps it in
 * the same language and test suite as the rest of the business logic.
 *
 * Note: if this API is ever scaled past one instance, these jobs need a lock
 * (or a dedicated worker process) so they do not run concurrently.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The map query already filters on `expires_at`, so jobs vanish from the
   * map on time regardless. This makes the status honest for the employer's
   * "My Jobs" list, and closes the applications still waiting on a decision
   * so workers are not left pending forever.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleJobs(): Promise<void> {
    const { expired, closed } = await this.prisma.$transaction(async (tx) => {
      // One statement, so it takes the same row locks as accept/reject and
      // cannot expire a job an employer is filling at this moment.
      const expired = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "jobs"
        SET "status" = 'expired'
        WHERE "status" = 'open' AND "expires_at" <= NOW()
        RETURNING "id"
      `;

      const closed = await rejectPendingApplications(
        tx,
        expired.map(({ id }) => id),
      );

      return { expired, closed };
    });

    this.notifications.applicationsClosed(closed, 'expired');

    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} job(s), closed ${closed.length} application(s)`);
    }
  }

  /**
   * Runs once a day, so a job can only fall inside the 24h window on a single
   * run — no need to track which reminders have already gone out.
   */
  @Cron('0 9 * * *', { timeZone: DEFAULT_TIMEZONE })
  async notifyExpiringJobs(): Promise<void> {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const jobs = await this.prisma.job.findMany({
      where: { status: 'open', expiresAt: { gt: now, lte: tomorrow } },
      select: { id: true, title: true, employerId: true },
    });

    for (const job of jobs) {
      this.notifications.jobExpiringSoon(job.employerId, job.id, job.title);
    }

    if (jobs.length > 0) {
      this.logger.log(`Sent ${jobs.length} expiry reminder(s)`);
    }
  }
}
