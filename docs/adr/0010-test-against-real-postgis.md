# 0010. End-to-end tests run against real Postgres + PostGIS

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

The logic most worth protecting is in SQL or depends on it: the PostGIS
radius query, the row locks behind slot counting, check constraints,
the rating trigger, and unique indexes that turn double-taps into 409s. A
mocked Prisma client would test none of it.

## Decision

- **Unit tests** (`*.spec.ts`, next to the code) cover pure logic: the
  lifecycle rules, URL checks, validation, push receipt handling.
- **End-to-end tests** (`apps/api/test/*.e2e-spec.ts`) boot the real
  `AppModule` with the production app setup, against a real Postgres 16 +
  PostGIS 3 database migrated with the real migrations. Requests go through
  HTTP with Supabase-shaped JWTs. Only `PushService` is replaced, by a fake
  that records what would have been sent.
- The e2e suite reads its database only from `TEST_DATABASE_URL` and refuses
  to start without it, because every test truncates all tables.
- CI runs both, plus the Prisma drift check
  ([ADR 0003](0003-postgis-location-via-trigger.md)).

## Consequences

- Running e2e locally needs Docker or a local PostGIS; see
  [testing.md](../testing.md).
- E2e suites run serially against one database. At about 50 tests this
  takes seconds; if it grows slow, give each worker its own schema.
- Time-dependent cases (ratings after a job starts, expiry) move rows through
  time with Prisma directly, since the API refuses past start times.
