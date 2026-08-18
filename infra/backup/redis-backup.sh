#!/usr/bin/env bash
#
# Copy the Redis dataset off-host.
#
# ── Why this is worth doing, and why it is second priority ───────────────────
# Redis runs with `--appendonly yes`, but the AOF sits on the same disk as
# Postgres. A disk failure takes both, so persistence on that disk is not a
# backup — it only protects against a process restart.
#
# What is actually at risk: BullMQ queues (in-flight transcode, PHI-scan,
# reminder and digest jobs) and the rate-limit / session-revalidation caches.
# Losing the caches is harmless — they rebuild. Losing the queues means jobs
# accepted but never run, with nothing to tell you which. That is the reason
# to keep a copy, and also why this matters less than the database.
#
# Usage: redis-backup.sh <production|staging>

set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  production | staging) ;;
  *)
    echo "usage: $0 <production|staging>" >&2
    exit 2
    ;;
esac

CONTAINER="lms-${ENVIRONMENT}-redis"
ENV_FILE="/home/deploy/apps/lms-${ENVIRONMENT}/.env.${ENVIRONMENT}"
KEY_FILE="/home/deploy/secrets/backup-sa-${ENVIRONMENT}.json"
BUCKET="${BACKUP_BUCKET:-gs://theraptly-lms-backups-${ENVIRONMENT}}"
STAGE_DIR="/home/deploy/backups/${ENVIRONMENT}"
SDK_IMAGE="google/cloud-sdk:slim"

log() { echo "[redis-backup][${ENVIRONMENT}] $*"; }
fail() {
  echo "[redis-backup][${ENVIRONMENT}] ERROR: $*" >&2
  exit 1
}

[ -f "$KEY_FILE" ] || fail "backup service-account key not found: $KEY_FILE"
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "container not running: $CONTAINER"

# The password is read into a variable and passed via the container's own
# environment, never as an argv element — arguments are visible in `ps` to
# every user on the host.
REDIS_PASSWORD="$(grep -E '^REDIS_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
[ -n "$REDIS_PASSWORD" ] || fail "REDIS_PASSWORD not found in ${ENV_FILE}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RDB_NAME="redis-${ENVIRONMENT}-${STAMP}.rdb"
mkdir -p "$STAGE_DIR"

cleanup() { rm -f "${STAGE_DIR}/${RDB_NAME}"; }
trap cleanup EXIT

# BGSAVE forks and returns immediately, so poll rdb_bgsave_in_progress rather
# than assuming the snapshot is on disk. LASTSAVE is compared before and after
# so a BGSAVE that fails outright cannot be mistaken for one that finished.
LAST_BEFORE="$(docker exec -e REDISCLI_AUTH="$REDIS_PASSWORD" "$CONTAINER" redis-cli LASTSAVE | tr -d '\r')"
log "triggering BGSAVE"
docker exec -e REDISCLI_AUTH="$REDIS_PASSWORD" "$CONTAINER" redis-cli BGSAVE >/dev/null

for _ in $(seq 1 120); do
  LAST_NOW="$(docker exec -e REDISCLI_AUTH="$REDIS_PASSWORD" "$CONTAINER" redis-cli LASTSAVE | tr -d '\r')"
  [ "$LAST_NOW" != "$LAST_BEFORE" ] && break
  sleep 1
done
[ "$LAST_NOW" != "$LAST_BEFORE" ] || fail "BGSAVE did not complete within 120s"

docker cp "${CONTAINER}:/data/dump.rdb" "${STAGE_DIR}/${RDB_NAME}" || fail "docker cp failed"
[ -s "${STAGE_DIR}/${RDB_NAME}" ] || fail "snapshot is empty"

log "uploading ${RDB_NAME}"
docker run --rm \
  -v "$KEY_FILE:/key.json:ro" \
  -v "$STAGE_DIR:/backups:ro" \
  "$SDK_IMAGE" \
  sh -c "
    set -e
    gcloud auth activate-service-account --key-file=/key.json --quiet
    gcloud storage cp '/backups/${RDB_NAME}' '${BUCKET}/redis/${STAMP:0:4}/${RDB_NAME}' --quiet
  " || fail "upload failed"

log "redis snapshot complete"
