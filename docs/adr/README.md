# Architecture Decision Records

Short records of decisions that shape the codebase. Each one says what was
decided, why, and what it costs, so a later change can revisit the reasoning
instead of rediscovering it.

| #                                                       | Decision                                                   | Status   |
| ------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)           | Record architecture decisions                              | Accepted |
| [0002](0002-nestjs-api-owns-data-access.md)             | A NestJS API owns data access; Supabase for auth + storage | Accepted |
| [0003](0003-postgis-location-via-trigger.md)            | PostGIS location maintained by trigger, searched raw       | Accepted |
| [0004](0004-job-and-application-lifecycle.md)           | Job and application lifecycle                              | Accepted |
| [0005](0005-row-locks-for-job-state-changes.md)         | Row locks for job state changes                            | Accepted |
| [0006](0006-contact-details-as-v1-payment-channel.md)   | Contact details are the v1 payment channel                 | Accepted |
| [0007](0007-in-process-scheduled-jobs.md)               | Scheduled jobs run in-process                              | Accepted |
| [0008](0008-push-delivery-and-receipt-checking.md)      | Push delivery: fire-and-forget, receipts checked in memory | Accepted |
| [0009](0009-per-user-rate-limiting.md)                  | Per-user rate limiting in the API                          | Accepted |
| [0010](0010-test-against-real-postgis.md)               | End-to-end tests run against real Postgres + PostGIS       | Accepted |
| [0011](0011-profile-photos-restricted-to-own-folder.md) | Profile photos restricted to the user's storage folder     | Accepted |

ADRs 0002, 0003, 0006 and 0007 were recorded after the fact. The decisions
date from the initial schema; the reasoning was in the README.

## Writing one

Copy [template.md](template.md) to the next free number. Keep it to a page.
An accepted ADR is not edited to reflect a new decision: write a new one
that supersedes it, and set the old one's status to
`Superseded by [NNNN](...)`.
