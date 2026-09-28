import { Injectable } from '@nestjs/common';

import type { ClosedApplication } from '../applications/application-closure';
import { PushService } from './push.service';

/** Why a job stopped taking applications. */
export type JobClosure = 'filled' | 'expired' | 'cancelled';

const CLOSURE_MESSAGES: Record<JobClosure, { title: string; body: (job: string) => string }> = {
  filled: { title: 'Position filled', body: (job) => `${job} has been filled` },
  expired: { title: 'Job closed', body: (job) => `${job} is no longer taking applications` },
  cancelled: { title: 'Job cancelled', body: (job) => `${job} was cancelled by the employer` },
};

/**
 * The notification events from the PRD, in one place, so the wording of a
 * message is not scattered across the services that trigger it.
 *
 * Every method is fire-and-forget — `PushService` never throws.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly push: PushService) {}

  newApplication(employerId: string, jobId: string, jobTitle: string): void {
    void this.push.sendToUser(employerId, {
      title: 'New applicant',
      body: `Someone applied for ${jobTitle}`,
      data: { type: 'application.created', jobId },
    });
  }

  applicationAccepted(
    workerId: string,
    jobId: string,
    jobTitle: string,
    employerName: string,
  ): void {
    void this.push.sendToUser(workerId, {
      title: 'You got the job!',
      body: `${jobTitle} at ${employerName}`,
      data: { type: 'application.accepted', jobId },
    });
  }

  applicationRejected(workerId: string, jobId: string, jobTitle: string): void {
    void this.push.sendToUser(workerId, {
      title: 'Application update',
      body: `Update on your application for ${jobTitle}`,
      data: { type: 'application.rejected', jobId },
    });
  }

  /** Tells applicants still waiting on a decision that the job closed. */
  applicationsClosed(closed: ClosedApplication[], reason: JobClosure): void {
    const message = CLOSURE_MESSAGES[reason];

    for (const { workerId, jobId, jobTitle } of closed) {
      void this.push.sendToUser(workerId, {
        title: message.title,
        body: message.body(jobTitle),
        data: { type: 'application.closed', reason, jobId },
      });
    }
  }

  /** Tells a worker who was hired that the job is off. */
  hiredJobCancelled(workerId: string, jobId: string, jobTitle: string): void {
    void this.push.sendToUser(workerId, {
      title: 'Job cancelled',
      body: `${jobTitle} was cancelled by the employer`,
      data: { type: 'job.cancelled', jobId },
    });
  }

  jobExpiringSoon(employerId: string, jobId: string, jobTitle: string): void {
    void this.push.sendToUser(employerId, {
      title: 'Your job expires tomorrow',
      body: `${jobTitle} will stop appearing on the map in 24 hours`,
      data: { type: 'job.expiring', jobId },
    });
  }
}
