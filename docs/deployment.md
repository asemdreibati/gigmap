# Deployment

The API ships as one container image and runs as stateless, disposable
instances behind a load balancer: any number of them, replaced at any time
([ADR 0012](adr/0012-run-as-stateless-containers.md)). Its only backing
services are Postgres (Supabase), optionally Redis, and outbound HTTPS to
Supabase Auth, Expo and Resend. The mobile and web apps are deployed
separately and only need the API's URL plus the Supabase URL and anon key.

Kubernetes users can start from [deploy/k8s](../deploy/k8s/README.md). The
rest of this page is platform-neutral.

## Image

CI builds the image on every pull request, smoke-tests it against PostGIS,
and on every push to `main` publishes:

```
ghcr.io/<owner>/gigmap-api:<full commit sha>
ghcr.io/<owner>/gigmap-api:latest
```

Deploy the SHA tag; `latest` is a convenience. To build locally:

```bash
docker build -t gigmap-api .
scripts/smoke-test-image.sh gigmap-api   # needs DATABASE_URL to a disposable PostGIS
```

It is a multi-stage build on `node:22-bookworm-slim`. The runtime stage runs
as the unprivileged `node` user, writes nothing outside `/tmp`, and works
with a read-only root filesystem.

## Release: migrate, then roll out

Run migrations once per release, **before** new instances start, with the
same image:

```bash
docker run --rm -e DATABASE_URL -e DIRECT_URL ghcr.io/<owner>/gigmap-api:<sha> \
  node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

`prisma migrate deploy` uses `DIRECT_URL` (a session-mode connection);
migrations cannot run through the transaction-mode pooler. Old instances keep
serving until the rollout finishes, so every migration must work with the
previous release too: add columns and tables, backfill, and only drop things
a release later.

## Health checks

| Route               | Use it for                | 200 when                                                        | Otherwise                                                     |
| ------------------- | ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET /health/live`  | liveness / restarts       | the process responds                                            | — (never checks the database)                                 |
| `GET /health/ready` | readiness / load balancer | the database answers within 2 s and the instance isn't draining | `503 {"status":"unavailable"}` or `503 {"status":"draining"}` |
| `GET /health`       | existing checks           | same as `/health/ready`                                         | same                                                          |

Never point a restart policy at `/health/ready`: a database outage would
restart every instance in a loop without fixing anything. The image's Docker
`HEALTHCHECK` uses `/health/live`. Health routes are public, unthrottled and
not access-logged.

## Shutdown

On SIGTERM an instance:

1. fails readiness and keeps serving for `SHUTDOWN_DRAIN_MS`, so the load
   balancer stops routing to it before it stops listening;
2. closes the HTTP server, letting in-flight requests finish;
3. lets push notifications already being sent finish (up to 5 s);
4. closes its database and Redis connections and exits.

Set the platform's termination grace period above
`SHUTDOWN_DRAIN_MS + 15 s`. Use `SHUTDOWN_DRAIN_MS=0` where the platform
stops routing before signalling (Cloud Run), and 5–10 s on Kubernetes, where
endpoint removal and SIGTERM race.

## Scaling out

Running several instances is supported. Nothing that matters is held in one
process:

| Concern             | How it stays correct across instances                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Job/applicant state | Row locks in Postgres ([ADR 0005](adr/0005-row-locks-for-job-state-changes.md)).                                                                             |
| Scheduled jobs      | Every instance runs them; each claims work with a single `UPDATE`, so nothing is done twice ([ADR 0013](adr/0013-scheduled-jobs-safe-on-every-instance.md)). |
| Rate limits         | Shared counters in Redis when `REDIS_URL` is set. Without it, each instance counts on its own ([ADR 0014](adr/0014-shared-rate-limits-in-redis.md)).         |
| Push receipt checks | Each instance checks the tickets it sent ([ADR 0008](adr/0008-push-delivery-and-receipt-checking.md)).                                                       |
| Sessions            | None; every request carries its own Supabase token.                                                                                                          |

The limit on scale is database connections; see pool sizing below.

## Logging

Logs go to stdout. With `NODE_ENV=production` each line is one JSON object
(`level`, `timestamp`, `context`, `message`, …) for the platform's log
pipeline; set `LOG_FORMAT=text` to read them by eye. Every request is tagged
with an id, returned as `X-Request-Id` and included in its access log line
and in any 5xx error log. A well-formed `X-Request-Id` from the load balancer
is reused, so ids line up across hops. Access logs omit query strings,
because map queries carry users' coordinates.

## Configuration

Validated at boot by [`config/env.ts`](../apps/api/src/config/env.ts). A
missing or malformed variable stops the process with a list of everything
that is wrong.

| Variable              | Required        | Notes                                                                                                    |
| --------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | yes             | Pooled, transaction mode (port 6543) with `pgbouncer=true`. See pool sizing below.                       |
| `DIRECT_URL`          | migrations only | Session mode (port 5432). Not read by the running API.                                                   |
| `SUPABASE_URL`        | yes             | `https://<ref>.supabase.co`. Token issuer, JWKS location, and the allowed origin for photo URLs.         |
| `SUPABASE_JWT_SECRET` | legacy only     | Set only on projects still signing with the shared HS256 secret; otherwise JWKS is used.                 |
| `REDIS_URL`           | multi-instance  | Shared rate-limit counters. Use `rediss://` for TLS. Optional with one instance.                         |
| `CORS_ORIGINS`        | no              | Comma-separated web origins. Mobile apps do not need CORS.                                               |
| `PORT`                | no              | Default `3333`. Set it if the platform assigns one.                                                      |
| `NODE_ENV`            | no              | `production` in deployed environments.                                                                   |
| `LOG_LEVEL`           | no              | `verbose`, `debug`, `log` (default), `warn`, `error`, `fatal`.                                           |
| `LOG_FORMAT`          | no              | `json` (default in production) or `text`.                                                                |
| `SHUTDOWN_DRAIN_MS`   | no              | Default `0`. See [Shutdown](#shutdown).                                                                  |
| `TRUST_PROXY_HOPS`    | no              | Proxies in front of the API, so `req.ip` is the client. Default `0`; usually `1` behind a load balancer. |
| `EXPO_ACCESS_TOKEN`   | no              | Only if enhanced push security is enabled on Expo.                                                       |
| `RESEND_API_KEY`      | no              | Without it, report emails are logged instead of sent.                                                    |
| `ADMIN_EMAIL`         | no              | Where reports are emailed. Sent from `alerts@gigmap.ch`, which must be a verified Resend domain.         |

The API needs neither the anon key nor the service-role key. Do not give it
the service-role key: it bypasses every access control in the project.

### Database pool sizing

Supabase's pooler caps client connections per project, and the cap depends on
the compute size. Each instance holds a Prisma pool of `connection_limit`
connections (a query parameter on `DATABASE_URL`):

```
max instances × connection_limit  <  pooler client limit (leave headroom for migrations and Studio)
```

`connection_limit=10` is a reasonable start; with the Kubernetes HPA's
maximum of 6 that is 60 connections. Do not use the `connection_limit=1` from
Supabase's serverless guides. It serialises every request in this
long-running process, and accept/reject transactions hold a connection for
their duration ([ADR 0005](adr/0005-row-locks-for-job-state-changes.md)).

## Region

The Supabase project must be in an EU region (Frankfurt) for nFADP/GDPR
posture and latency in Switzerland. Deploy the API, and Redis, in the same
region. See [supabase-setup.md](supabase-setup.md).
