# Testing

```bash
pnpm test        # unit tests, all packages — no database needed
pnpm test:e2e    # end-to-end tests — needs TEST_DATABASE_URL, optionally TEST_REDIS_URL
pnpm lint        # ESLint (type-aware)
pnpm typecheck
pnpm format:check
```

CI runs all of these, plus the Prisma drift check, on every pull request
(`.github/workflows/ci.yml`). The strategy is in
[ADR 0010](adr/0010-test-against-real-postgis.md).

## Unit tests

`*.spec.ts` next to the code they test, in `apps/api/src` and
`packages/shared/src`. Use them for anything that is pure logic: lifecycle
rules, validation schemas, URL checks, receipt handling with Expo mocked.

## End-to-end tests

`apps/api/test/*.e2e-spec.ts`. They boot the real Nest app with the
production setup (`configureApp`) against a real Postgres + PostGIS, and
drive it over HTTP.

### Database

Any disposable Postgres 16 with PostGIS 3 works. With Docker:

```bash
docker run -d --name gigmap-test-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=gigmap_test \
  -p 5433:5432 postgis/postgis:16-3.4

docker run -d --name gigmap-test-redis -p 6380:6379 redis:7-alpine

export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/gigmap_test
export TEST_REDIS_URL=redis://localhost:6380   # optional; CI always sets it
pnpm test:e2e
```

The suite migrates the database once per run and **truncates every table
before each test**. It only ever reads `TEST_DATABASE_URL`, never
`DATABASE_URL`, and refuses to start without it, so it cannot wipe your
development data by accident.

Without `TEST_REDIS_URL`, the suite that runs two instances against one
shared Redis is skipped; everything else runs.

### Several instances

Some properties only exist across instances: scheduled jobs that must not
repeat work, and rate limits shared through Redis. Their suites start two
apps against the same database (`test/scheduled-jobs.e2e-spec.ts`,
`test/rate-limits.e2e-spec.ts`):

```ts
const [a, b] = await Promise.all([createTestApp(), createTestApp()]);
await Promise.all([
  a.app.get(MaintenanceService).notifyExpiringJobs(),
  b.app.get(MaintenanceService).notifyExpiringJobs(),
]);
```

`createTestApp({ redisUrl })` connects an app to Redis, and
`createTestApp({ shutdownDrainMs })` sets its drain period for shutdown
tests.

### The image

`scripts/smoke-test-image.sh <image>` migrates, boots, probes and stops a
built image against `DATABASE_URL` (a disposable PostGIS). CI runs it on
every pull request.

### Writing one

Helpers are in [`test/support/test-app.ts`](../apps/api/test/support/test-app.ts):

```ts
const ctx = await createTestApp(); // once per file, in beforeAll
await resetDatabase(ctx.prisma); // in beforeEach

const employer = await signUp(ctx, 'employer'); // signed JWT + onboarding
const worker = await signUp(ctx, 'worker');
const job = await postJob(ctx, employer, { slots: 2 });
const applicationId = await apply(ctx, worker, job.id);

await ctx
  .as(employer)
  .patch(`/v1/applications/${applicationId}`)
  .send({ status: 'accepted' })
  .expect(200);

expect(ctx.push.typesFor(worker.id)).toEqual(['application.accepted']);
```

- `ctx.push` is a fake `PushService` that records what would have been sent.
- `ctx.prisma` is for setup the API deliberately refuses, like moving a
  job's start time into the past to test ratings, and for asserting on rows
  the API does not expose. Prefer the API otherwise.
- Tokens are HS256-signed with a test secret, the same path legacy Supabase
  projects use, so no network is involved.
- Suites run serially (`maxWorkers: 1`) because they share one database.

## Prisma drift check

`schema.prisma` and the hand-written migrations must describe the same
database ([ADR 0003](adr/0003-postgis-location-via-trigger.md)):

```bash
createdb gigmap_shadow   # any empty database on a PostGIS server
SHADOW_DATABASE_URL=postgresql://…/gigmap_shadow \
  pnpm --filter @gigmap/api prisma:check-drift
```

It exits non-zero and prints the SQL that would reconcile them if they
differ.
