# 0007. Scheduled jobs run in-process

- **Status:** Accepted (recorded retroactively)
- **Date:** 2026-08-12

## Context

Three things run on a schedule:

- the hourly expiry sweep (`MaintenanceService.expireStaleJobs`),
- the daily 09:00 Europe/Zurich reminder for jobs expiring within 24 h,
- the 10-minute push receipt check
  ([ADR 0008](0008-push-delivery-and-receipt-checking.md)).

The PRD used pg_cron and Edge Functions.

## Decision

Run them in the API process with `@nestjs/schedule`, next to the services
whose rules they apply.

## Alternatives considered

- **pg_cron.** It would put the expiry rules and notification fan-out in SQL,
  apart from the rest of the lifecycle ([ADR 0004](0004-job-and-application-lifecycle.md)).
- **A separate worker process.** It is the right shape at scale, but adds
  a second deployable for three small jobs.

## Consequences

- **Each API instance runs every job.** Running more than one instance means
  the reminder is sent once per instance. The expiry sweep is safe to run
  concurrently, because its `UPDATE … WHERE status = 'open'` is idempotent
  under row locks. Before scaling out, add a lock (e.g.
  `pg_try_advisory_lock`) around each job, or move them to a single worker.
- Jobs are skipped while the process is down. The sweep catches up on its
  next run, but a missed 09:00 reminder is simply not sent.
