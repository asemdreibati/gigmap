#!/usr/bin/env bash
# Smoke-tests a built API image the way a platform would run it:
# migrate with the image, boot it, wait for readiness, probe it, stop it.
#
#   DATABASE_URL=postgresql://… scripts/smoke-test-image.sh gigmap-api:ci
#
# DATABASE_URL must point at a disposable PostGIS database reachable from
# the host network.
set -euo pipefail

IMAGE=${1:?usage: smoke-test-image.sh <image>}
: "${DATABASE_URL:?DATABASE_URL must be set}"
NAME=gigmap-smoke-$$
PORT=${PORT:-3333}
BASE=http://127.0.0.1:$PORT

cleanup() { docker rm -f "$NAME" > /dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -50 >&2 || true
  exit 1
}

echo "--> migrate (release step, same image)"
docker run --rm --network host -e DATABASE_URL -e DIRECT_URL="$DATABASE_URL" "$IMAGE" \
  node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "--> start"
docker run -d --name "$NAME" --network host \
  -e DATABASE_URL \
  -e SUPABASE_URL=https://smoke.supabase.co \
  -e PORT="$PORT" \
  -e SHUTDOWN_DRAIN_MS=1000 \
  "$IMAGE" > /dev/null

echo "--> wait for readiness"
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/health/ready" > /dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "$BASE/health/ready" | grep -q '"database":"up"' || fail "never became ready"
curl -fsS "$BASE/health/live" | grep -q '"status":"ok"' || fail "liveness"

echo "--> runs as non-root"
[ "$(docker exec "$NAME" id -u)" != "0" ] || fail "container runs as root"

echo "--> rejects unauthenticated API calls"
status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/users/me")
[ "$status" = "401" ] || fail "expected 401 from /v1/users/me, got $status"

echo "--> logs JSON in production"
docker logs "$NAME" 2>&1 | head -1 | grep -q '^{"level":' || fail "logs are not JSON"

echo "--> stops gracefully"
docker stop -t 30 "$NAME" > /dev/null
docker logs "$NAME" 2>&1 | grep -q 'draining for 1000 ms' || fail "no drain on SIGTERM"
# Nest re-raises the signal after its shutdown hooks, so 143 (SIGTERM) is a
# clean exit here; anything else means it crashed or was killed.
code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")
[ "$code" = "0" ] || [ "$code" = "143" ] || fail "exit code $code"

echo "OK: $IMAGE"
