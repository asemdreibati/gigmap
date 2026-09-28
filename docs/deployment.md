# Deployment

The API ships as one Docker image, built from the repo root. The mobile and
web apps are deployed separately and only need the API's URL plus the
Supabase URL and anon key.

## Build

```bash
docker build -t gigmap-api .
```

It is a multi-stage build on `node:22-bookworm-slim`: frozen-lockfile install,
build `@gigmap/shared` and the API, prune dev dependencies, then copy the
result into a runtime stage that runs as the unprivileged `node` user.

## Release: migrate, then roll out

Run migrations once per release, **before** starting new containers, using
the same image:

```bash
docker run --rm -e DATABASE_URL -e DIRECT_URL gigmap-api \
  node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

`prisma migrate deploy` uses `DIRECT_URL` (a session-mode connection).
Migrations cannot run through the transaction-mode pooler. Only additive
migrations are safe to apply while old containers are still serving.

Then start the API:

```bash
docker run -p 3333:3333 --env-file .env.production gigmap-api
```

The image's `HEALTHCHECK` polls `GET /health`, which returns
`{"status":"ok","database":"up"}`, or `"degraded"` when the database is
unreachable. Point the platform's health check at the same route; it is
exempt from rate limiting.

## Configuration

Validated at boot by [`config/env.ts`](../apps/api/src/config/env.ts). A
missing or malformed required variable stops the process with a list of
what is wrong.

| Variable                    | Required        | Notes                                                                                            |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`              | yes             | Pooled, transaction mode (port 6543) with `pgbouncer=true`. See pool sizing below.               |
| `DIRECT_URL`                | migrations only | Session mode (port 5432). Not read by the running API.                                           |
| `SUPABASE_URL`              | yes             | `https://<ref>.supabase.co`. Token issuer, JWKS location, and the allowed origin for photo URLs. |
| `SUPABASE_JWT_SECRET`       | legacy only     | Set only on projects still signing with the shared HS256 secret; otherwise JWKS is used.         |
| `SUPABASE_ANON_KEY`         | yes¹            | Not currently used by the API.                                                                   |
| `SUPABASE_SERVICE_ROLE_KEY` | yes¹            | Not currently used by the API. Never ship it to a client.                                        |
| `CORS_ORIGINS`              | no              | Comma-separated web origins. Mobile apps do not need CORS.                                       |
| `PORT`                      | no              | Default `3333`.                                                                                  |
| `NODE_ENV`                  | no              | `production` in deployed environments.                                                           |
| `EXPO_ACCESS_TOKEN`         | no              | Only if enhanced push security is enabled on Expo.                                               |
| `RESEND_API_KEY`            | no              | Without it, report emails are logged instead of sent.                                            |
| `ADMIN_EMAIL`               | no              | Where reports are emailed. Sent from `alerts@gigmap.ch`, which must be a verified Resend domain. |

¹ Required by validation today even though no code path reads it. Supply it,
but treat it as a secret.

### Database pool sizing

Supabase's pooler caps client connections per project, and the cap depends on
the compute size. The API holds a Prisma pool of `connection_limit`
connections per instance:

```
instances × connection_limit  <  pooler client limit (leave headroom for migrations and Studio)
```

`connection_limit=10` is a reasonable start for one instance. Do not use the
`connection_limit=1` from Supabase's serverless guides. It serialises every
request in this long-running process, and accept/reject transactions hold a
connection for their duration
([ADR 0005](adr/0005-row-locks-for-job-state-changes.md)).

## Running more than one instance

The API is built to run as **a single instance** today. Three things are
per-process:

| What                                                                       | Effect with N instances                    | Fix before scaling out                                    |
| -------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Scheduled jobs ([ADR 0007](adr/0007-in-process-scheduled-jobs.md))         | Daily expiry reminder sent N times         | Advisory lock around each job, or a single worker process |
| Rate limits ([ADR 0009](adr/0009-per-user-rate-limiting.md))               | Each user gets up to N× their budget       | Redis storage for `@nestjs/throttler`                     |
| Push receipts ([ADR 0008](adr/0008-push-delivery-and-receipt-checking.md)) | None; each instance checks its own tickets | —                                                         |

The expiry sweep itself is safe to run concurrently.

## Region

The Supabase project must be in an EU region (Frankfurt) for nFADP/GDPR
posture and latency in Switzerland. Deploy the API in the same region. See
[supabase-setup.md](supabase-setup.md).
