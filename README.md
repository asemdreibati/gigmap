# GigMap

Uber-style job board: workers open a live map of short-term jobs near them and
apply with one tap; employers drop a pin and manage applicants.

See [gigmap prd.md](gigmap%20prd.md) for the product spec. This README covers
the code; deeper docs and architecture decisions are in [docs/](docs/README.md).

---

## Architecture

```
apps/api        NestJS  — owns all data access and business logic
packages/shared TypeScript — Zod schemas, constants, response types
apps/mobile     Expo    — not built yet
apps/web        Next.js — not built yet
```

**Supabase is the identity provider and the database, not the backend.** Auth
and Storage stay with Supabase; everything else goes through the API.

Clients use `supabase-js` for exactly two things — signing in and uploading
files. They never call `.from()`. All reads and writes go through the NestJS
API, which authorises in the service layer.

Why this split:

- Auth is the worst thing to hand-roll. Email verification, password reset,
  refresh-token rotation and secure session storage on mobile are weeks of work
  and the highest-consequence place to have a subtle bug.
- The business logic this app needs — slot locking, rating eligibility, push
  orchestration, scheduled expiry — does not fit in row-level policies. Putting
  it in one TypeScript service layer beats splitting it across PL/pgSQL, RLS
  and Deno edge functions.
- RLS is still enabled on every table with **no permissive policies**, so a
  leaked anon key exposes nothing through PostgREST. The API connects as the
  owner role and bypasses it. Defence in depth, not the primary control.

---

## Setup

### Prerequisites

- **Node 22 LTS.** Node 20.9 is below what NestJS 11 wants (20.11+).
- pnpm 9 — `corepack enable && corepack prepare pnpm@9.12.3 --activate`
- A Supabase project, **created in an EU region (Frankfurt)**. The region cannot
  be changed later, and it matters for nFADP/GDPR posture and Swiss latency.
  Setup steps, including the avatars bucket: [docs/supabase-setup.md](docs/supabase-setup.md).
- Docker, for the end-to-end tests' PostGIS database.

### Install

```bash
pnpm install
cp .env.example .env      # then fill it in
```

### Database

The initial migration is hand-written because Prisma cannot express the PostGIS
extension, the geography column, the GiST indexes or the triggers.

```bash
pnpm db:deploy            # apply migrations
pnpm db:generate          # regenerate the Prisma client
```

Verify PostGIS came up:

```sql
select postgis_version();
```

### Run

```bash
pnpm --filter @gigmap/shared build    # the API imports the compiled output
pnpm --filter @gigmap/api dev
```

`GET http://localhost:3333/health` should return `{"status":"ok","database":"up"}`.

### Check

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                 # unit tests
pnpm test:e2e             # end-to-end, needs TEST_DATABASE_URL — see docs/testing.md
```

CI runs all of these plus a Prisma schema/migration drift check on every pull
request. Deployment (Docker image, migrations, configuration) is in
[docs/deployment.md](docs/deployment.md).

---

## API surface

All routes are under `/v1` and require `Authorization: Bearer <supabase access token>`,
except `/health`.

| Method | Route | Role | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | public | Liveness + DB reachability |
| `POST` | `/v1/users/me` | any | Create profile + pick role (once, after sign-up) |
| `GET` | `/v1/users/me` | any | Own profile |
| `PATCH` | `/v1/users/me` | any | Edit profile, skills, company details |
| `GET` | `/v1/users/:id` | any | Public profile (never returns email/phone) |
| `POST` | `/v1/users/me/push-tokens` | any | Register an Expo push token |
| `DELETE` | `/v1/users/me/push-tokens/:token` | any | Deregister on sign-out |
| `GET` | `/v1/jobs/nearby` | any | **Map + list view.** `?lat&lng&radiusKm&category&limit` |
| `GET` | `/v1/jobs/mine` | employer | Own postings, all statuses |
| `GET` | `/v1/jobs/:id` | any | Job detail |
| `POST` | `/v1/jobs` | employer | Post a job |
| `PATCH` | `/v1/jobs/:id` | employer | Edit an open job |
| `PATCH` | `/v1/jobs/:id/status` | employer | Mark filled / cancel |
| `POST` | `/v1/jobs/:jobId/applications` | worker | Apply |
| `GET` | `/v1/jobs/:jobId/applications` | employer | Applicant list |
| `GET` | `/v1/applications/mine` | worker | My applications `?status=` |
| `PATCH` | `/v1/applications/:id` | employer | Accept / reject |
| `GET` | `/v1/ratings/pending` | any | Ratings still owed |
| `POST` | `/v1/ratings` | any | Leave a 1–5 star rating |
| `POST` | `/v1/reports` | any | Report a job or user |

Validation errors return `422` with per-field messages:

```json
{ "statusCode": 422, "message": "Title is too short", "errors": { "title": ["Title is too short"] } }
```

In `PATCH` bodies, omitting a field leaves it unchanged and `null` clears an
optional one (`phone`, `bio`, `photoUrl`, `companyName`, `website`,
`durationHours`).

Requests are rate-limited per user (120/min overall; reports, job posts and
applications have tighter hourly budgets). Over the limit, the API returns
`429` with `Retry-After`. See [ADR 0009](docs/adr/0009-per-user-rate-limiting.md).

---

## Things worth knowing

### The map query

`GET /v1/jobs/nearby` is raw SQL in
[jobs.service.ts](apps/api/src/modules/jobs/jobs.service.ts) because the radius
test is a PostGIS predicate Prisma cannot express. `ST_DWithin` against the GiST
index on `location` is what keeps it fast — a naive distance filter would
sequentially scan every job in the country.

It also excludes jobs whose slots are all taken, so full postings drop off the
map without the employer doing anything.

### PostGIS and Prisma coexist via a trigger

Prisma Client cannot read or write a `geography` column. So application code
only ever writes `latitude` / `longitude`, and a `BEFORE INSERT OR UPDATE`
trigger derives `location` from them. The geo index is therefore always correct,
and no service code has to think about it.

**When changing `schema.prisma`, always use `--create-only` and read the SQL
before applying:**

```bash
pnpm --filter @gigmap/api exec prisma migrate dev --create-only
```

Prisma does not know about the extension or the triggers. The GiST index is
declared in the schema so Prisma leaves it alone, and CI fails if the schema
and the migrations ever drift apart
([ADR 0003](docs/adr/0003-postgis-location-via-trigger.md)).

### Job and application lifecycle

Job status changes go through one state machine,
[`job-lifecycle.ts`](apps/api/src/modules/jobs/job-lifecycle.ts). In short:

- A job takes applications and acceptances only while `open`, unexpired and
  not full. Taking the last slot fills it.
- A job the employer marks filled **stays** filled. Withdrawing an acceptance
  only reopens a job that filled up by itself.
- Filling, cancelling or expiring a job closes its pending applications and
  notifies those workers. Cancelling also notifies hired workers.
- A posting lasts `max(posted + 7 days, start time)`, and edits cannot extend
  that.

Diagrams and the full table of side effects are in
[docs/job-lifecycle.md](docs/job-lifecycle.md); the push payloads are in
[docs/notifications.md](docs/notifications.md).

### Concurrency

Two employer sessions accepting the last slot at the same moment is a real
race. Every operation that changes a job's status or headcount runs in a
transaction holding `SELECT … FOR UPDATE` on the job row. Applying takes
`FOR SHARE`, so it cannot slip in behind a close. The
`jobs_filled_slots_check` constraint is the backstop
([ADR 0005](docs/adr/0005-row-locks-for-job-state-changes.md)).

### Contact details are the v1 payment mechanism

There is no Stripe in v1 — the two parties arrange payment themselves. So
`email` and `phone` are absent from `PublicUser` entirely and are released only
on an **accepted** application, to both sides. Do not add them to the public
mapper ([ADR 0006](docs/adr/0006-contact-details-as-v1-payment-channel.md)).

### Profile photos

Clients upload to Supabase Storage at `avatars/<user id>/…`, then save the
public URL. The API rejects `photoUrl`s anywhere else
([ADR 0011](docs/adr/0011-profile-photos-restricted-to-own-folder.md)).

### Scheduled work

`@nestjs/schedule` replaces what would have been pg_cron: an hourly expiry
sweep, a daily 09:00 Europe/Zurich reminder for jobs expiring within 24h, and a
10-minute Expo push-receipt check that prunes dead device tokens. They run
in-process, as do the rate-limit counters. **If the API is ever scaled past
one instance, read the scale-out section of
[docs/deployment.md](docs/deployment.md#running-more-than-one-instance)
first.**

---

## Divergences from the PRD

The PRD predates the decision to run a real backend. Where they disagree, the
code is current.

| PRD | Here | Why |
| --- | --- | --- |
| Supabase client direct from apps, RLS as authz | NestJS owns data access; RLS deny-all | Business logic needs a service layer |
| Edge Functions + DB webhooks + pg_cron | Nest services + `@nestjs/schedule` | One language, one test suite |
| Hand-written TS interfaces (§12) | `packages/shared` + Prisma-generated models | The PRD's `Job` had `latitude`/`longitude`, the schema had a geography column — already drifted |
| `ratings unique(job_id, rater_id)` | `unique(job_id, rater_id, rated_id)` | An employer with 3 slots hires 3 workers and must rate each |
| `users` "public read" policy | `PublicUser` omits email/phone | The PRD policy exposed every user's contact details to anyone with the anon key |
| No `filled_slots` column | Added, with a check constraint | Nothing enforced `slots` |
| No push token storage | `push_tokens` table | Nowhere to send to |

---

## Next

1. Expo app — auth flow, then the map screen against `/v1/jobs/nearby`
2. Apply → accept → notify loop end to end on a real device
3. Employer post-job form with map pin placement
4. Profiles, ratings, reports
5. Next.js: landing page + employer flows only (the browser worker map is
   deliberately out of v1 scope)
