import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Application as ApplicationRow, type Job as JobRow } from '@prisma/client';
import type {
  Application,
  ApplicationStatus,
  ListApplicationsQuery,
  UpdateApplicationInput,
} from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toJob, toPublicUser, userProfileInclude } from '../../common/mappers';
import { NotificationsService } from '../notifications/notifications.service';

/** Job row as returned by the `FOR UPDATE` lock query. */
interface LockedJob {
  id: string;
  employerId: string;
  title: string;
  slots: number;
  filledSlots: number;
  status: string;
  expiresAt: Date;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async apply(workerId: string, jobId: string): Promise<Application> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        employerId: true,
        title: true,
        slots: true,
        filledSlots: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== 'open' || job.expiresAt <= new Date()) {
      throw new BadRequestException('This job is no longer accepting applications');
    }

    if (job.filledSlots >= job.slots) {
      throw new ConflictException('All positions for this job have been filled');
    }

    try {
      const application = await this.prisma.application.create({
        data: { jobId, workerId },
      });

      this.notifications.newApplication(job.employerId, job.id, job.title);

      return toApplication(application);
    } catch (error) {
      // Racing double-taps on the Apply button land here via the
      // (job_id, worker_id) unique index.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already applied for this job');
      }
      throw error;
    }
  }

  /** The worker's "My Applications" screen. */
  async findForWorker(
    workerId: string,
    query: ListApplicationsQuery,
  ): Promise<Application[]> {
    const applications = await this.prisma.application.findMany({
      where: { workerId, ...(query.status ? { status: query.status } : {}) },
      include: { job: { include: { employer: { include: userProfileInclude } } } },
      orderBy: { createdAt: 'desc' },
    });

    return applications.map((application) => ({
      ...toApplication(application),
      job: toJob(application.job),
      // Contact details are the payment mechanism in v1 — they are released
      // to the worker only once the employer has accepted them.
      contact:
        application.status === 'accepted'
          ? {
              name: application.job.employer.name,
              phone: application.job.employer.phone,
              email: application.job.employer.email,
            }
          : null,
    }));
  }

  /** The employer's applicant list for one of their jobs. */
  async findForJob(employerId: string, jobId: string): Promise<Application[]> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { employerId: true },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.employerId !== employerId) {
      throw new ForbiddenException('This job belongs to another employer');
    }

    const applications = await this.prisma.application.findMany({
      where: { jobId },
      include: { worker: { include: userProfileInclude } },
      orderBy: { createdAt: 'asc' },
    });

    return applications.map((application) => ({
      ...toApplication(application),
      worker: toPublicUser(application.worker),
      contact:
        application.status === 'accepted'
          ? {
              name: application.worker.name,
              phone: application.worker.phone,
              email: application.worker.email,
            }
          : null,
    }));
  }

  /**
   * Accept or reject an applicant.
   *
   * The job row is locked with `SELECT ... FOR UPDATE` for the duration of the
   * transaction. Without it, two employer sessions accepting at the same moment
   * would both read `filled_slots < slots`, both write `filled_slots + 1`, and
   * overfill the job — the check constraint would then reject one of them with
   * a 500 rather than a clean conflict.
   */
  async updateStatus(
    employerId: string,
    applicationId: string,
    input: UpdateApplicationInput,
  ): Promise<Application> {
    const result = await this.prisma.$transaction(async (tx) => {
      const application = await tx.application.findUnique({
        where: { id: applicationId },
        include: { worker: { include: userProfileInclude } },
      });

      if (!application) {
        throw new NotFoundException('Application not found');
      }

      const [job] = await tx.$queryRaw<LockedJob[]>`
        SELECT "id",
               "employer_id"  AS "employerId",
               "title",
               "slots",
               "filled_slots" AS "filledSlots",
               "status"::text AS "status",
               "expires_at"   AS "expiresAt"
        FROM "jobs"
        WHERE "id" = ${application.jobId}::uuid
        FOR UPDATE
      `;

      if (!job) {
        throw new NotFoundException('Job not found');
      }

      if (job.employerId !== employerId) {
        throw new ForbiddenException('This job belongs to another employer');
      }

      if (job.status === 'cancelled') {
        throw new BadRequestException('This job has been cancelled');
      }

      if (application.status === input.status) {
        return { application, job, changed: false } as const;
      }

      // +1 when a slot is taken, -1 when an acceptance is withdrawn.
      const delta =
        (input.status === 'accepted' ? 1 : 0) - (application.status === 'accepted' ? 1 : 0);
      const filledSlots = job.filledSlots + delta;

      if (filledSlots > job.slots) {
        throw new ConflictException('All positions for this job have been filled');
      }

      const updated = await tx.application.update({
        where: { id: applicationId },
        data: { status: input.status },
        include: { worker: { include: userProfileInclude } },
      });

      if (delta !== 0) {
        await tx.job.update({
          where: { id: job.id },
          data: {
            filledSlots,
            status: nextJobStatus(filledSlots, job),
          },
        });
      }

      return { application: updated, job, changed: true } as const;
    });

    if (result.changed) {
      const employer = await this.prisma.user.findUniqueOrThrow({
        where: { id: employerId },
        select: { name: true },
      });

      if (input.status === 'accepted') {
        this.notifications.applicationAccepted(
          result.application.workerId,
          result.job.id,
          result.job.title,
          employer.name,
        );
      } else {
        this.notifications.applicationRejected(
          result.application.workerId,
          result.job.id,
          result.job.title,
        );
      }
    }

    return {
      ...toApplication(result.application),
      worker: toPublicUser(result.application.worker),
    };
  }
}

/**
 * A job goes to `filled` when the last slot is taken and drops back to `open`
 * if an acceptance is later withdrawn — unless it has aged out in the meantime.
 */
function nextJobStatus(filledSlots: number, job: LockedJob): JobRow['status'] {
  if (filledSlots >= job.slots) {
    return 'filled';
  }
  return job.expiresAt > new Date() ? 'open' : 'expired';
}

function toApplication(application: ApplicationRow): Application {
  return {
    id: application.id,
    jobId: application.jobId,
    workerId: application.workerId,
    status: application.status as ApplicationStatus,
    createdAt: application.createdAt.toISOString(),
  };
}
