# Kubernetes

Reference manifests for running the API on any conformant cluster (EKS, GKE,
AKS, k3s…). They encode the runtime contract from
[ADR 0012](../../docs/adr/0012-run-as-stateless-containers.md): probes,
graceful shutdown, a read-only non-root container, and migrations as a
separate release step.

```
base/      Deployment, Service, HPA, PodDisruptionBudget, ConfigMap (config.env)
migrate/   Job that runs `prisma migrate deploy` with the same image
```

Not included, because they depend on your cluster: Ingress / Gateway
(TLS, host name), a namespace, and how secrets are delivered (External
Secrets, Sealed Secrets, your cloud's secret store).

## 1. Secrets

The pods read secrets from a Secret named `gigmap-api-secrets`:

```bash
kubectl create secret generic gigmap-api-secrets \
  --from-literal=DATABASE_URL='postgresql://…:6543/postgres?pgbouncer=true&connection_limit=10' \
  --from-literal=DIRECT_URL='postgresql://…:5432/postgres' \
  --from-literal=REDIS_URL='rediss://…' \
  --from-literal=RESEND_API_KEY='…' \
  --from-literal=ADMIN_EMAIL='ops@example.com'
```

`REDIS_URL` is optional but recommended with more than one replica
([ADR 0014](../../docs/adr/0014-shared-rate-limits-in-redis.md)). Add
`SUPABASE_JWT_SECRET` only for a legacy-JWT Supabase project and
`EXPO_ACCESS_TOKEN` only if enhanced push security is on. The API needs no
Supabase API key.

Non-secret settings live in [`base/config.env`](base/config.env). Set at
least `SUPABASE_URL` and `CORS_ORIGINS`.

## 2. Release

Pin both kustomizations to the image built for the commit you are
deploying. CI publishes `ghcr.io/<owner>/gigmap-api:<full commit sha>` on
every push to `main`.

```bash
TAG=$(git rev-parse HEAD)
(cd deploy/k8s/base && kustomize edit set image gigmap-api=ghcr.io/asemdreibati/gigmap-api:$TAG)
(cd deploy/k8s/migrate && kustomize edit set image gigmap-api=ghcr.io/asemdreibati/gigmap-api:$TAG)

# 1. Migrate first. Jobs are immutable, so replace the previous run.
kubectl delete job gigmap-api-migrate --ignore-not-found
kubectl apply -k deploy/k8s/migrate
kubectl wait --for=condition=complete job/gigmap-api-migrate --timeout=10m

# 2. Then roll out.
kubectl apply -k deploy/k8s/base
kubectl rollout status deployment/gigmap-api
```

Migrations must be backwards compatible with the release still running
(additive columns, new tables), because old pods serve until the rollout
finishes.

## What the manifests rely on

| Setting                                                        | Why                                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `livenessProbe` → `/health/live`                               | Never touches the database, so an outage cannot restart every pod.                                                                                   |
| `readinessProbe` → `/health/ready`                             | Fails when the database is unreachable and while the pod drains.                                                                                     |
| `SHUTDOWN_DRAIN_MS=10000`, `terminationGracePeriodSeconds: 40` | After SIGTERM the pod keeps serving with readiness failing until endpoints update, then drains in-flight requests and pending pushes before exiting. |
| `maxUnavailable: 0`, PDB `minAvailable: 1`                     | Rollouts and node drains never take the last pod.                                                                                                    |
| No `replicas` in the Deployment                                | The HPA owns the count (2–6 on CPU).                                                                                                                 |
| `readOnlyRootFilesystem`, non-root, no capabilities            | Nothing writes outside `/tmp` (an `emptyDir`).                                                                                                       |
| HPA `maxReplicas: 6`                                           | Keep `maxReplicas × connection_limit` under the Supabase pooler's client limit.                                                                      |

## Other platforms

The image follows the same contract anywhere containers run. Set `PORT` if
the platform assigns one, route health checks to `/health/ready`, and run
the migration command from the image as a release/pre-deploy step:

```
node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

On platforms that stop routing before sending SIGTERM (e.g. Cloud Run),
leave `SHUTDOWN_DRAIN_MS` at 0.
