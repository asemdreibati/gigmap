# 0012. Run the API as stateless, disposable containers

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

The API was written to run as one long-lived process. Container platforms
(Kubernetes, Cloud Run, ECS, Fly…) assume the opposite: instances start and
stop at any time, several run at once behind a load balancer, and the
platform decides where traffic goes from health checks. Several things broke
that contract:

- `/health` returned 200 with the database down, and there was no way to
  separate "restart me" from "don't send me traffic".
- `PrismaService` disconnected in `onModuleDestroy`, which Nest runs _before_
  closing the HTTP server, so requests in flight during a rolling deploy lost
  their connection pool.
- Logs were coloured text, and nothing tied an error to a request.
- State that must be shared lived in process memory (scheduled-job
  bookkeeping, rate-limit counters; ADRs 0013 and 0014).
- The image had never been built or run in CI.

## Decision

The API follows a twelve-factor style runtime contract:

- **Config** only from environment variables, validated at boot. No secret
  the API does not use is required.
- **Probes.** `/health/live` (process responsive, never touches the
  database) and `/health/ready` (database answers within 2 s, not draining).
  Restarts key off liveness, routing off readiness.
- **Shutdown.** On SIGTERM: fail readiness, keep serving for
  `SHUTDOWN_DRAIN_MS`, close the HTTP server and let requests finish, let
  pending pushes finish (≤ 5 s), then close database and Redis connections.
  `PrismaService` disconnects in `onApplicationShutdown`, after the drain.
- **Logs** to stdout as JSON lines in production, each request tagged with
  an `X-Request-Id` (reused from upstream when well-formed). Access logs omit
  query strings, which carry users' coordinates.
- **Backing services** are attached by URL: Postgres (`DATABASE_URL`) and
  optionally Redis (`REDIS_URL`).
- **Disposability.** Anything that must survive an instance lives in a
  backing service. What may be lost (pending push receipt checks, ADR 0008)
  is documented as such.
- **One image, built and smoke-tested in CI**, published to GHCR from
  `main`. Migrations run from that image as a release step before rollout,
  never at container start.
- **Hardened runtime.** Non-root, read-only root filesystem (writes only to
  `/tmp`), no capabilities. Kubernetes reference manifests live in
  `deploy/k8s/`.

## Alternatives considered

- **Running migrations on container start.** Every replica would race to
  migrate, and a failed migration would crash-loop the fleet instead of
  failing one release step.
- **Serverless functions.** The row-locking transactions, the in-process
  schedulers and the push fan-out suit a long-lived process; per-invocation
  connection setup against the pooler would also cost more.
- **A service mesh / sidecars** for retries, mTLS and telemetry. It is
  premature for one service; the API's own probes, logs and shutdown are
  what any platform needs first.

## Consequences

- The API scales horizontally; the limit is database connections
  (`instances × connection_limit`, see [deployment.md](../deployment.md)).
- Every migration must be compatible with the previous release, because both
  run during a rollout.
- Platform-specific pieces (ingress, secrets delivery, TLS) stay out of the
  repo. The Kubernetes manifests are a reference, not the only way to run
  the image.
