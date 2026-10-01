# 0014. Share rate-limit counters in Redis, failing open

- **Status:** Accepted
- **Date:** 2026-10-01
- **Supersedes:** [0009](0009-per-user-rate-limiting.md)

## Context

ADR 0009 introduced per-user rate limits with counters in process memory and
noted that N instances would give each user N times their budget. With the
API now running as several instances (ADR 0012), that is the normal case.

## Decision

The limits themselves are unchanged from ADR 0009: keyed on the user id after
authentication; 120 requests/min overall; reports 10/h, job posts 20/h,
applications 60/h; `/health*` exempt; `429` with `Retry-After`.

Where the counters live changes:

- With `REDIS_URL` set, counters live in Redis
  (`@nest-lab/throttler-storage-redis`), so a budget holds across every
  instance and survives restarts.
- Without it, counters stay in process memory, which is fine for a single
  instance and local development.
- **Fail open.** If Redis errors, that request is counted in local memory and
  a warning is logged (at most once a minute). The client fails fast while
  disconnected (no offline queue, 500 ms command timeout), so a Redis outage
  loosens limits to per-instance and never blocks or fails requests.
- Readiness does not depend on Redis, for the same reason.

## Alternatives considered

- **Counters in Postgres.** No new service, but a write per API request on the
  hottest path, competing with real work for pooler connections.
- **Fail closed** (reject requests when Redis is down). It protects the
  budget, but it turns a cache outage into a full API outage.
- **Rate limiting only at the edge.** The edge cannot see the user id, and
  per-IP limits punish users behind carrier NAT.

## Consequences

- Multi-instance deployments should set `REDIS_URL`. Any managed Redis works
  (Upstash, ElastiCache, Memorystore); keep it in the same region.
- During a Redis outage a determined user gets up to N times their budget.
- Throttler keys are hashed, so Redis holds no user ids in clear.
