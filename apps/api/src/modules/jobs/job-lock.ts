import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JobStatus } from '@gigmap/shared';

import type { JobState } from './job-lifecycle';

export interface LockedJob extends JobState {
  id: string;
  employerId: string;
  title: string;
  createdAt: Date;
}

/**
 * - `update`: for anything that changes the job's status or headcount.
 *   Serialises accept/reject, status changes, edits and the expiry sweep.
 * - `share`: for applying. Applications do not block each other, but cannot
 *   slip in while the job is being closed.
 *
 * See ADR 0005.
 */
export type JobLockMode = 'update' | 'share';

const LOCK_CLAUSES: Record<JobLockMode, Prisma.Sql> = {
  update: Prisma.sql`FOR UPDATE`,
  share: Prisma.sql`FOR SHARE`,
};

/**
 * Reads a job row and holds a row lock on it until the surrounding
 * transaction ends. Prisma Client has no API for row locks, hence raw SQL.
 */
export async function lockJob(
  tx: Prisma.TransactionClient,
  jobId: string,
  mode: JobLockMode,
): Promise<LockedJob | null> {
  const [job] = await tx.$queryRaw<(Omit<LockedJob, 'status'> & { status: JobStatus })[]>`
    SELECT "id",
           "employer_id"  AS "employerId",
           "title",
           "slots",
           "filled_slots" AS "filledSlots",
           "status"::text AS "status",
           "expires_at"   AS "expiresAt",
           "created_at"   AS "createdAt"
    FROM "jobs"
    WHERE "id" = ${jobId}::uuid
    ${LOCK_CLAUSES[mode]}
  `;

  return job ?? null;
}

/** Narrows a looked-up job to one that exists and belongs to `employerId`. */
export function requireOwnedJob(job: LockedJob | null, employerId: string): LockedJob {
  if (!job) {
    throw new NotFoundException('Job not found');
  }

  if (job.employerId !== employerId) {
    throw new ForbiddenException('This job belongs to another employer');
  }

  return job;
}
