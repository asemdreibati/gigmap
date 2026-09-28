import { JOB_EXPIRY_DAYS, type JobStatus, type UpdateJobStatusInput } from '@gigmap/shared';

/**
 * The job state machine, as pure functions so the rules can be tested without
 * a database. See docs/job-lifecycle.md for the diagram and ADR 0004 for why
 * it looks like this.
 *
 *   open ──(last slot accepted)──▶ filled ──(acceptance withdrawn)──▶ open
 *   open ──(employer)────────────▶ filled            (stays filled)
 *   open ──(expires_at passes)───▶ expired
 *   open | filled ──(employer)───▶ cancelled
 *
 * `expired` and `cancelled` are terminal.
 */

/** The columns every lifecycle decision reads. */
export interface JobState {
  status: JobStatus;
  slots: number;
  filledSlots: number;
  expiresAt: Date;
}

export type ManualJobStatus = UpdateJobStatusInput['status'];

export function isFull(job: Pick<JobState, 'slots' | 'filledSlots'>): boolean {
  return job.filledSlots >= job.slots;
}

/** Whether the job can take new applications and new acceptances. */
export function isAcceptingWorkers(job: JobState, now = new Date()): boolean {
  return job.status === 'open' && job.expiresAt > now && !isFull(job);
}

/**
 * A job marked `filled` while it still has free slots was closed by the
 * employer by hand. That is the only way to reach this state: automatic
 * filling happens exactly when the last slot is taken, and acceptances are
 * refused once a job is no longer open.
 */
export function isClosedByEmployer(job: JobState): boolean {
  return job.status === 'filled' && !isFull(job);
}

/**
 * Why an employer may not move a job from `from` to `to`, or null if they
 * may. A request for the status the job already has is not an error — the
 * caller treats it as a no-op.
 */
export function manualTransitionError(from: JobStatus, to: ManualJobStatus): string | null {
  if (from === to) {
    return null;
  }

  switch (from) {
    case 'open':
    case 'filled':
      return null;
    case 'expired':
      return 'This job has expired';
    case 'cancelled':
      return 'This job has been cancelled';
  }
}

/**
 * The status a job moves to when its accepted headcount changes to
 * `filledSlots`.
 *
 * Taking the last slot fills the job. Withdrawing an acceptance reopens a job
 * that had filled up on its own — but not one the employer closed by hand,
 * and not one whose posting window has passed in the meantime.
 */
export function statusAfterHeadcountChange(
  job: JobState,
  filledSlots: number,
  now = new Date(),
): JobStatus {
  if (job.status === 'expired' || job.status === 'cancelled') {
    return job.status;
  }

  if (filledSlots >= job.slots || isClosedByEmployer(job)) {
    return 'filled';
  }

  return job.expiresAt > now ? 'open' : 'expired';
}

/**
 * When a posting stops taking applications: its start time, or the standard
 * window after it was posted, whichever is later. A job starting three weeks
 * out should not vanish from the map after seven days.
 *
 * Anchored to `createdAt`, not to "now", so editing a job — including moving
 * its start time — cannot keep it on the map indefinitely.
 */
export function postingExpiry(createdAt: Date, startTime: Date): Date {
  const standard = new Date(createdAt.getTime() + JOB_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return startTime > standard ? startTime : standard;
}
