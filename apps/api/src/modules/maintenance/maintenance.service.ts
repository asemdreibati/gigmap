import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DEFAULT_TIMEZONE } from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { rejectPendingApplications } from '../applications/application-closure';
import { NotificationsService } from '../notifications/notifications.service';

/** How far ahead of `expires_at` an employer is reminded. */
const EXPIRY_REMINDER_WINDOW = '24 hours';

/**
 * Scheduled work that used to need pg_cron. Running it in-process keeps it in
 * the same language and test suite as the rest of the business logic.
 *
 * Every instance runs these. Each job is written so concurrent runs are
 * harmless: they claim rows with a single UPDATE, so work is never done
 * twice (ADR 0013).
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
   * Reminds employers about open jobs leaving the map within a day.
   *
   * Each job is claimed by setting `expiry_reminder_sent_at` in the same
   * statement that selects it, so a reminder goes out exactly once no matter
   * how many instances run this at the same moment — the row locks make the
   * second instance's UPDATE skip what the first claimed. Running hourly
   * through the day (never at night) also catches up after a missed run.
   */
  @Cron('0 9-20 * * *', { timeZone: DEFAULT_TIMEZONE })
  async notifyExpiringJobs(): Promise<void> {
    const due = await this.prisma.$queryRaw<{ id: string; title: string; employerId: string }[]>`
      UPDATE "jobs"
      SET "expiry_reminder_sent_at" = NOW()
      WHERE "status" = 'open'
        AND "expiry_reminder_sent_at" IS NULL
        AND "expires_at" > NOW()
        AND "expires_at" <= NOW() + ${EXPIRY_REMINDER_WINDOW}::interval
      RETURNING "id", "title", "employer_id" AS "employerId"
    `;

    for (const job of due) {
      this.notifications.jobExpiringSoon(job.employerId, job.id, job.title);
    }

    if (due.length > 0) {
      this.logger.log(`Sent ${due.length} expiry reminder(s)`);
    }
  }
}
