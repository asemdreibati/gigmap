# 0013. Scheduled jobs are safe to run on every instance

- **Status:** Accepted
- **Date:** 2026-10-01
- **Supersedes:** [0007](0007-in-process-scheduled-jobs.md)

## Context

ADR 0007 ran scheduled jobs in-process and noted they would need a lock
before scaling out. With the API running as several disposable instances
(ADR 0012), each instance's scheduler fires independently:

- The daily 09:00 expiry reminder was sent once per instance, skipped
  entirely if no instance was up at 09:00, and its fixed 24 h window
  repeated or skipped jobs on DST days.
- The hourly expiry sweep was already safe: one `UPDATE … WHERE status =
'open' … RETURNING` that a second instance finds nothing left to update.

## Decision

Keep the jobs in-process on every instance, and make each one claim its
work atomically in the database instead of relying on only one instance
running it:

- **Expiry sweep** (hourly): unchanged, one `UPDATE … RETURNING` in a
  transaction that also closes the expired jobs' pending applications.
- **Expiry reminders** (hourly, 09:00–20:00 Europe/Zurich): a column
  `jobs.expiry_reminder_sent_at` records the claim. One
  `UPDATE … SET expiry_reminder_sent_at = NOW() WHERE … IS NULL … RETURNING`
  selects and claims due jobs; row locks make concurrent runs skip claimed
  rows. Editing a job's start time clears the claim.
- **Push receipt checks** (every 10 min): per instance by design; each
  checks the tickets it sent (ADR 0008).

The pattern for any future job: make the work a set of rows, and claim them
in the same statement that reads them.

## Alternatives considered

- **Postgres advisory locks** around each job. Session locks do not survive
  the transaction-mode pooler. Transaction locks prevent overlap but not
  repetition: a second instance firing a moment later would run the job
  again.
- **A leader / single worker process.** Correct, but adds a deployable or a
  leader-election mechanism for three small jobs, and a missed run still
  needs catch-up logic.
- **The platform's scheduler** (Kubernetes CronJob, Cloud Scheduler) calling
  an endpoint. Portable across platforms only if every platform is
  configured, and it still needs idempotent work.

## Consequences

- Each job runs N times per period with N instances; all but one find
  nothing to do. The queries are indexed and cheap.
- Missed periods catch up: a reminder not sent at 09:00 goes out at the first
  later daytime run.
- The two-instance e2e suite (`test/scheduled-jobs.e2e-spec.ts`) is the
  regression test for this property.
