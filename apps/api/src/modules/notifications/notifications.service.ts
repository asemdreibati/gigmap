import { Injectable } from '@nestjs/common';

import { PushService } from './push.service';

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

  jobExpiringSoon(employerId: string, jobId: string, jobTitle: string): void {
    void this.push.sendToUser(employerId, {
      title: 'Your job expires tomorrow',
      body: `${jobTitle} will stop appearing on the map in 24 hours`,
      data: { type: 'job.expiring', jobId },
    });
  }
}
