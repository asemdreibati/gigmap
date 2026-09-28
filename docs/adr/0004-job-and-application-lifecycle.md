# 0004. Job and application lifecycle

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Jobs move between `open`, `filled`, `expired` and `cancelled`. Applications
move between `pending`, `accepted` and `rejected`. The original code handled
transitions locally in each service, and that caused three bugs:

1. **A job marked filled by hand reopened itself.** Accepting or withdrawing
   an applicant recomputed the status from the headcount alone, so a 3-slot
   job the employer had closed with nobody hired went back to `open` and
   reappeared on the map.
2. **Nobody was told when a job closed.** Pending applications on filled,
   cancelled or expired jobs stayed `pending` forever, and hired workers were
   not told about a cancellation.
3. **Editing a job reset its expiry to "now + 7 days"**, so a posting could be
   kept alive forever. Edits could also move the start time into the past.

## Decision

The rules live in one pure module, `apps/api/src/modules/jobs/job-lifecycle.ts`,
with unit tests. [docs/job-lifecycle.md](../job-lifecycle.md) has the diagram.

**Jobs**

- A job accepts applications and acceptances only while it is `open`, before
  `expires_at`, with a free slot.
- Taking the last slot moves it to `filled`. Shrinking `slots` to the number
  already hired does the same.
- Employers may move `open → filled`, `open → cancelled` and
  `filled → cancelled`. `expired` and `cancelled` are terminal. Requesting
  the current status is a no-op.
- Withdrawing an acceptance reopens a job **only if it filled up by
  itself**. A job that is `filled` with free slots can only have got there by
  hand, because acceptances are refused once a job is not open. So "closed by
  the employer" is derived from `status = 'filled' AND filled_slots < slots`,
  with no extra column.
- `expires_at = max(created_at + 7 days, start_time)`, anchored to when the
  job was posted. A start time must be in the future on create and on edit.

**Applications**

- When a job stops hiring (filled, cancelled, expired), its `pending`
  applications become `rejected` in the same transaction. Each of those
  workers gets an `application.closed` push carrying the reason.
- On cancellation, hired workers get a `job.cancelled` push. Their
  applications stay `accepted` as the record of who was hired.

## Alternatives considered

- **A `closed_manually` column** to tell hand-closed jobs from full ones.
  Redundant: the state already implies it, and a column can disagree with
  the state it describes.
- **A new application status (`closed`/`withdrawn`)** instead of reusing
  `rejected`. It would be more precise, but it needs an enum migration, a
  shared-type change and client handling for a distinction the push
  notification already carries. Revisit if workers need it in the UI.
- **Letting employers accept on a hand-closed job.** It keeps a mis-tap
  recoverable, but it makes "filled" mean nothing and re-creates bug 1.
  The honest fix for a mis-tap would be an explicit reopen action. That
  doesn't exist today.

## Consequences

- There is no way to reopen a job an employer closed by hand. If that is
  needed, add `filled → open` as an explicit manual transition rather than
  loosening the acceptance rule.
- A worker whose application was closed sees `rejected`. The client should
  show the job's status alongside it ("Job filled", "Job cancelled") so it
  does not read as a judgement on them.
- Every path that changes a job's status must go through the lifecycle
  functions and close pending applications. Today those paths are
  `JobsService.update`, `JobsService.updateStatus`,
  `ApplicationsService.updateStatus` and `MaintenanceService.expireStaleJobs`.
