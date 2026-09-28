import type { Prisma } from '@prisma/client';

/** A pending application that was closed because its job stopped hiring. */
export interface ClosedApplication {
  workerId: string;
  jobId: string;
  jobTitle: string;
}

/**
 * Rejects every pending application on the given jobs, returning who needs
 * to be told.
 *
 * Call it inside the transaction that closes the jobs, while their rows are
 * locked: `apply` takes a share lock on the job, so no new pending
 * application can be inserted between the read and the update here.
 */
export async function rejectPendingApplications(
  tx: Prisma.TransactionClient,
  jobIds: string[],
): Promise<ClosedApplication[]> {
  if (jobIds.length === 0) {
    return [];
  }

  const where = { jobId: { in: jobIds }, status: 'pending' as const };

  const pending = await tx.application.findMany({
    where,
    select: { workerId: true, jobId: true, job: { select: { title: true } } },
  });

  await tx.application.updateMany({ where, data: { status: 'rejected' } });

  return pending.map(({ workerId, jobId, job }) => ({ workerId, jobId, jobTitle: job.title }));
}
