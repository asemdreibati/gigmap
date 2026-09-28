import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DEFAULT_TIMEZONE } from '@gigmap/shared';

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
   * The map query already filters on `expires_at`, so this is about the
   * employer's "My Jobs" list showing an honest status.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleJobs(): Promise<void> {
    const { count } = await this.prisma.job.updateMany({
      where: { status: 'open', expiresAt: { lte: new Date() } },
      data: { status: 'expired' },
    });

    if (count > 0) {
      this.logger.log(`Expired ${count} job(s)`);
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
