import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Application as ApplicationRow } from '@prisma/client';
import type { Application, ListApplicationsQuery, UpdateApplicationInput } from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toJob, toPublicUser, userProfileInclude } from '../../common/mappers';
import { isAcceptingWorkers, isFull, statusAfterHeadcountChange } from '../jobs/job-lifecycle';
import { lockJob, requireOwnedJob } from '../jobs/job-lock';
import { NotificationsService } from '../notifications/notifications.service';
import { rejectPendingApplications, type ClosedApplication } from './application-closure';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async apply(workerId: string, jobId: string): Promise<Application> {
    const { application, job } = await this.prisma.$transaction(async (tx) => {
      // A share lock: applications to the same job do not wait on each other,
      // but one cannot land after a concurrent close has swept the pending
      // applications — it waits for the close, then sees the job closed.
      const job = await lockJob(tx, jobId, 'share');

      if (!job) {
        throw new NotFoundException('Job not found');
      }

      if (!isAcceptingWorkers(job)) {
        throw isFull(job)
          ? new ConflictException('All positions for this job have been filled')
          : new BadRequestException('This job is no longer accepting applications');
      }

      try {
        const application = await tx.application.create({ data: { jobId, workerId } });
        return { application, job };
      } catch (error) {
        // Racing double-taps on the Apply button land here via the
        // (job_id, worker_id) unique index.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('You have already applied for this job');
        }
        throw error;
      }
    });

    this.notifications.newApplication(job.employerId, job.id, job.title);

    return toApplication(application);
  }

  /** The worker's "My Applications" screen. */
  async findForWorker(workerId: string, query: ListApplicationsQuery): Promise<Application[]> {
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
   * Accept or reject an applicant, or withdraw an earlier acceptance.
   *
   * The job row is locked for the duration of the transaction. Without it,
   * two employer sessions accepting at the same moment would both read
   * `filled_slots < slots`, both write `filled_slots + 1`, and overfill the
   * job — the check constraint would then reject one of them with a 500
   * rather than a clean conflict.
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

      const job = requireOwnedJob(await lockJob(tx, application.jobId, 'update'), employerId);

      if (job.status === 'cancelled') {
        throw new BadRequestException('This job has been cancelled');
      }

      if (application.status === input.status) {
        return { application, job, changed: false, closed: [] } as const;
      }

      // +1 when a slot is taken, -1 when an acceptance is withdrawn.
      const delta =
        (input.status === 'accepted' ? 1 : 0) - (application.status === 'accepted' ? 1 : 0);

      if (delta > 0 && !isAcceptingWorkers(job)) {
        throw isFull(job)
          ? new ConflictException('All positions for this job have been filled')
          : new BadRequestException('This job is no longer accepting workers');
      }

      const updated = await tx.application.update({
        where: { id: applicationId },
        data: { status: input.status },
        include: { worker: { include: userProfileInclude } },
      });

      let closed: ClosedApplication[] = [];

      if (delta !== 0) {
        const filledSlots = job.filledSlots + delta;
        const status = statusAfterHeadcountChange(job, filledSlots);

        await tx.job.update({ where: { id: job.id }, data: { filledSlots, status } });

        if (job.status === 'open' && status === 'filled') {
          closed = await rejectPendingApplications(tx, [job.id]);
        }
      }

      return { application: updated, job, changed: true, closed } as const;
    });

    if (result.changed) {
      this.notifications.applicationsClosed(result.closed, 'filled');

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

function toApplication(application: ApplicationRow): Application {
  return {
    id: application.id,
    jobId: application.jobId,
    workerId: application.workerId,
    status: application.status,
    createdAt: application.createdAt.toISOString(),
  };
}
