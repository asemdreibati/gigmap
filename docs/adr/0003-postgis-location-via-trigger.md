# 0003. PostGIS location maintained by trigger, searched with raw SQL

- **Status:** Accepted (recorded retroactively; drift check added 2026-09-28)
- **Date:** 2026-08-12

## Context

The map shows open jobs within a radius of the user. Done well, that is a
PostGIS `ST_DWithin` on a `geography` column backed by a GiST index. Without
the index, every map pan is a sequential scan over every job.

Prisma Client cannot read or write a `geography` column (it is
`Unsupported`), cannot express `ST_DWithin`, and does not manage extensions
or triggers.

## Decision

- `jobs` stores `latitude` and `longitude` as plain doubles, which Prisma
  owns. A `BEFORE INSERT OR UPDATE OF latitude, longitude` trigger derives
  `location geography(Point, 4326)` from them. Application code never
  touches `location`.
- The radius query (`JobsService.findNearby`) is raw SQL through
  `$queryRaw`, parameterised with `Prisma.sql`.
- The GiST index on `location` is declared in `schema.prisma`
  (`@@index([location], type: Gist)`) as well as created in the init
  migration. Prisma then treats it as intended state instead of drift.
- CI runs `prisma migrate diff --exit-code` between the migrations and the
  schema (`pnpm --filter @gigmap/api prisma:check-drift`) and fails on any
  difference.

## Alternatives considered

- **Bounding-box filter on lat/lng B-tree indexes.** Workable, but
  distance ordering and correctness near the radius edge need the same maths
  PostGIS already does, and the result is slower.
- **Write `location` from the app with raw SQL.** Every write path would
  have to remember it; the trigger makes it impossible to forget.

## Consequences

- Schema changes must use `prisma migrate dev --create-only` and have their
  SQL read before applying. Prisma still knows nothing about the triggers,
  the extension or the partial index `jobs_open_location_idx`.
- Before the index was declared in the schema, the next `migrate dev` would
  have generated `DROP INDEX "jobs_location_idx"`. The CI drift check
  exists to catch that class of mistake.
