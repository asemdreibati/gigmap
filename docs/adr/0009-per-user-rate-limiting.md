# 0009. Per-user rate limiting in the API

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Several endpoints fan out to other people: a report emails the admin, an
application pushes to an employer, and a posting appears on every nearby
worker's map. Nothing limited how often any of them could be called.

## Decision

- `@nestjs/throttler` runs as a global guard, **after** authentication, and
  keys on the **user id** (falling back to IP only where there is no user).
- Budgets live in `apps/api/src/config/rate-limits.ts`:

  | Scope                   | Limit     |
  | ----------------------- | --------- |
  | Any authenticated route | 120 / min |
  | `POST /v1/reports`      | 10 / hour |
  | `POST /v1/jobs`         | 20 / hour |
  | Apply to a job          | 60 / hour |

- `/health` is exempt.
- A throttled request gets `429` in the standard error shape, with a
  `Retry-After` header.

## Alternatives considered

- **Per-IP limits.** Mobile users share carrier NAT addresses, so one
  abusive user would throttle strangers, and one user on changing networks
  escapes the limit.
- **Only at the edge (load balancer / WAF).** The edge cannot see who the
  user is. It remains the right place for unauthenticated floods, which the
  API rejects at token verification before any database work.

## Consequences

- Counters are in process memory. With N instances, a user effectively gets
  up to N times the budget. Before scaling out, back the throttler with
  shared storage (a Redis store for `@nestjs/throttler`).
- Limits reset when the process restarts.
- Clients should treat `429` as "try again later" and honour `Retry-After`.
