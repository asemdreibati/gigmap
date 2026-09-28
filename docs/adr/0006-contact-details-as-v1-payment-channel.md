# 0006. Contact details are the v1 payment channel

- **Status:** Accepted (recorded retroactively)
- **Date:** 2026-08-12

## Context

v1 has no payments (Stripe Connect is phase 2). The two parties need some way
to arrange pay and logistics once a worker is hired. The PRD's `users`
"public read" policy exposed every user's email and phone to anyone.

## Decision

- `PublicUser`, the only user shape returned about other people, has no
  `email` or `phone` field at all.
- Contact details are released on an **accepted** application only, to both
  sides: the worker sees the employer's in `GET /v1/applications/mine`, and
  the employer sees the worker's in `GET /v1/jobs/:jobId/applications`.
- Withdrawing the acceptance withdraws the access.

## Consequences

- The mappers in `apps/api/src/common/mappers.ts` are the enforcement point.
  Never add `email` or `phone` to `toPublicUser`.
- Once released, details cannot be un-shared; withdrawal only stops the API
  from showing them again.
- Phase 2 (payments, in-app messaging) may make this unnecessary; that would
  be a new ADR.
