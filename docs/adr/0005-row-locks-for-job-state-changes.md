# 0005. Row locks for job state changes

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

`jobs.filled_slots` must equal the number of accepted applications, and must
never exceed `slots`. Several requests can touch the same job at once: two
employer sessions accepting the last slot, an edit shrinking `slots` while an
acceptance lands, a cancellation racing a worker's application, and the
hourly expiry sweep.

The original code locked the job only when accepting. Edits and status
changes read and wrote without a lock. A lost race either overfilled the job
(caught by the `jobs_filled_slots_check` constraint as a 500) or left a
pending application on a closed job.

## Decision

Every operation that reads a job's state to decide what to write takes a row
lock first, via `lockJob(tx, id, mode)` in
`apps/api/src/modules/jobs/job-lock.ts`, inside an interactive transaction:

| Operation                  | Lock                    |
| -------------------------- | ----------------------- |
| Accept / reject / withdraw | `FOR UPDATE`            |
| Edit job, change status    | `FOR UPDATE`            |
| Expiry sweep               | row locks of `UPDATE …` |
| Apply                      | `FOR SHARE`             |

`FOR SHARE` on apply means applications to the same job do not block each
other, but an application cannot be inserted while the job is being closed.
It waits, then sees the job closed and is refused. Closing a job therefore
never leaves a `pending` application behind.

The check constraint stays as the backstop.

## Alternatives considered

- **`SERIALIZABLE` isolation** with retries. It is correct, but every caller
  needs retry logic, and the conflicts are exactly the rows we would lock
  anyway.
- **Optimistic concurrency** (a version column, `UPDATE … WHERE version = ?`).
  It pushes retries to the client for what is a server-side invariant.
- **Doing the headcount in a trigger.** It would work for the counter, but
  the surrounding rules (who may accept, closing applications, notifying)
  would then be split between SQL and TypeScript.

## Consequences

- The transactions are short (a handful of indexed statements), so lock hold
  times are milliseconds. They must stay that way: no network calls,
  notifications included, inside a locked transaction.
- Interactive transactions need a pooled connection each for their duration.
  Pool sizing is in [deployment.md](../deployment.md).
- Prisma Client has no row-lock API, so `lockJob` is raw SQL. Its column
  list must be kept in step with `LockedJob`.
