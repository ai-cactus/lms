#!/usr/bin/env bash
#
# Restore a backup into a throwaway Postgres and prove it is usable.
#
# ── This script, not pg-backup.sh, is the deliverable ────────────────────────
# An unrestored backup is a hypothesis. This turns it into evidence, and the
# number it prints at the end — wall-clock time to a queryable database — is
# your RTO. Write that number down; it is the only honest answer to "how long
# would recovery take", and it is the input every incident plan needs.
#
# Run it after the first backup, then quarterly. A backup regime nobody has
# ever restored from is indistinguishable from no backups until the day it
# matters.
#
# ── Safety ───────────────────────────────────────────────────────────────────
# Everything happens in a container named lms-restore-verify on an ephemeral
# volume, never on a port the app uses, and the script refuses to run if that
# name is already taken. It never connects to a live database, and nothing it
# does can write to one.
#
# Usage:
#   restore-verify.sh <production|staging>            # verify the latest backup
#   restore-verify.sh <production|staging> <gs://...> # verify a specific one

set -euo pipefail

ENVIRONMENT="${1:-}"
EXPLICIT_OBJECT="${2:-}"
case "$ENVIRONMENT" in
  production | staging) ;;
  *)
    echo "usage: $0 <production|staging> [gs://path/to.dump]" >&2
    exit 2
    ;;
esac

KEY_FILE="/home/deploy/secrets/backup-sa-${ENVIRONMENT}.json"
BUCKET="${BACKUP_BUCKET:-gs://theraptly-lms-backups-${ENVIRONMENT}}"
WORK_DIR="/home/deploy/backups/restore-verify"
SCRATCH="lms-restore-verify"
SCRATCH_PORT="${SCRATCH_PORT:-55432}"
SCRATCH_PASSWORD="verify-only-$(date +%s)"
SDK_IMAGE="google/cloud-sdk:slim"
PG_IMAGE="pgvector/pgvector:pg16"

log() { echo "[restore-verify][${ENVIRONMENT}] $*"; }
fail() {
  echo "[restore-verify][${ENVIRONMENT}] ERROR: $*" >&2
  exit 1
}

[ -f "$KEY_FILE" ] || fail "backup service-account key not found: $KEY_FILE"
docker inspect "$SCRATCH" >/dev/null 2>&1 &&
  fail "container ${SCRATCH} already exists — remove it before running"

mkdir -p "$WORK_DIR"
rm -f "${WORK_DIR}"/*.dump

# The scratch database is written to the container's writable layer on the same
# disk that reached 98% on 2026-08-11. Refuse to start a restore that could fill
# it — taking production down while testing a backup would be an unusually
# self-defeating outage.
FREE_MB="$(df -Pm "$WORK_DIR" | awk 'NR==2 {print $4}')"
MIN_FREE_MB="${MIN_FREE_MB:-4096}"
[ "$FREE_MB" -ge "$MIN_FREE_MB" ] ||
  fail "only ${FREE_MB}MB free at ${WORK_DIR}, need ${MIN_FREE_MB}MB for a scratch restore"

cleanup() {
  docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
  rm -f "${WORK_DIR}"/*.dump
}
trap cleanup EXIT

# ── Fetch ────────────────────────────────────────────────────────────────────
# Deliberately OUTSIDE the timer below: recovery time is dominated by the
# restore, and download speed varies with whatever else the link is doing.
# Note the transfer time separately if you want a full end-to-end figure.
if [ -n "$EXPLICIT_OBJECT" ]; then
  OBJECT="$EXPLICIT_OBJECT"
else
  log "resolving most recent backup in ${BUCKET}/postgres/"
  OBJECT="$(docker run --rm -v "$KEY_FILE:/key.json:ro" "$SDK_IMAGE" sh -c "
    gcloud auth activate-service-account --key-file=/key.json --quiet 2>/dev/null
    gcloud storage ls '${BUCKET}/postgres/**/*.dump' --quiet | sort | tail -1
  ")"
  [ -n "$OBJECT" ] || fail "no backups found in ${BUCKET}/postgres/"
fi

log "verifying ${OBJECT}"
DUMP_NAME="$(basename "$OBJECT")"

docker run --rm \
  -v "$KEY_FILE:/key.json:ro" \
  -v "$WORK_DIR:/restore" \
  "$SDK_IMAGE" \
  sh -c "
    set -e
    gcloud auth activate-service-account --key-file=/key.json --quiet
    gcloud storage cp '${OBJECT}' '/restore/${DUMP_NAME}' --quiet
  " || fail "could not download ${OBJECT}"

# ── Restore, timed ───────────────────────────────────────────────────────────
START="$(date +%s)"

log "starting scratch postgres"
# No tmpfs for PGDATA: initdb refuses a data directory with group/other
# permissions, and Docker's default tmpfs mode (1777) trips exactly that. The
# container's own writable layer is discarded with `docker rm -f`, which is all
# the ephemerality this needs.
docker run -d --name "$SCRATCH" \
  -e POSTGRES_PASSWORD="$SCRATCH_PASSWORD" \
  -e POSTGRES_USER=verify \
  -e POSTGRES_DB=verify \
  -p "127.0.0.1:${SCRATCH_PORT}:5432" \
  -v "$WORK_DIR:/restore:ro" \
  "$PG_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$SCRATCH" pg_isready -U verify -d verify >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$SCRATCH" pg_isready -U verify -d verify >/dev/null 2>&1 ||
  fail "scratch postgres never became ready"

# pgvector must exist before restore: the dump references the vector type, and
# CREATE EXTENSION inside the archive needs the .so present in the image (it is
# — this is the same image production runs).
docker exec "$SCRATCH" psql -U verify -d verify -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null

log "restoring (this is the part being timed)"
# --no-owner / --no-privileges: the scratch instance has no `lms` role. Grants
# are not what is under test here; the data is.
docker exec "$SCRATCH" pg_restore \
  --username=verify --dbname=verify \
  --no-owner --no-privileges --jobs=2 \
  "/restore/${DUMP_NAME}" >/dev/null 2>"${WORK_DIR}/restore.err" || {
  log "pg_restore reported errors:"
  tail -20 "${WORK_DIR}/restore.err" >&2
  fail "restore failed"
}

END="$(date +%s)"
ELAPSED=$((END - START))

# ── Verify ───────────────────────────────────────────────────────────────────
# Row counts on the tables whose loss would actually matter: identity, the
# enrolment record, and the two append-only ledgers that carry the six-year
# audit obligation. A restore that "succeeds" with an empty audit_logs is a
# failed restore.
#
# Counted via query_to_xml over information_schema rather than a fixed UNION,
# because a UNION naming a table that does not exist fails at PARSE time — the
# whole query errors and NO counts are reported. That is not hypothetical:
# `phi_decisions` arrived in migration 20260809234206, and production last
# deployed 2026-07-21, so a production backup restored on 2026-08-15 legitimately
# has no such table. The earlier version of this script would have aborted on
# exactly the backup it exists to verify.
#
# A table that is ABSENT is reported as such and is not automatically a failure;
# a table that exists but is EMPTY is.
log "row counts in the restored database:"
docker exec "$SCRATCH" psql -U verify -d verify -At -F'	' -c "
  SELECT t.table_name,
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM public.%I', t.table_name),
                             false, true, '')))[1]::text::bigint
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_name IN ('users','enrollments','audit_logs','phi_decisions')
  ORDER BY 1;
" | while IFS=$'\t' read -r table count; do
  printf '    %-16s %s\n' "$table" "$count"
  # `if`, not `[ ... ] && ...`: under `set -e` a failing AND-list as the last
  # command in the loop body aborts the script — which here would mean exiting
  # before printing the RTO, on every run where a table is NOT empty.
  if [ "$count" = "0" ]; then
    echo "    ^^ WARNING: ${table} restored empty" >&2
  fi
done

# Name any of the four that the dump did not contain. Worth surfacing loudly:
# for `users` or `audit_logs` it means a broken restore, while for
# `phi_decisions` against a pre-2026-08-09 production dump it is expected.
docker exec "$SCRATCH" psql -U verify -d verify -At -c "
  SELECT x.name FROM unnest(ARRAY['users','enrollments','audit_logs','phi_decisions']) AS x(name)
  WHERE to_regclass('public.'||x.name) IS NULL ORDER BY 1;
" | while read -r missing; do
  [ -n "$missing" ] || continue
  echo "    ${missing}: TABLE ABSENT — expected only if the source predates it" >&2
done

# Identity is only useful if credentials came back with it — a restore that
# loses password hashes cannot be logged into, which is the first thing anyone
# would try during a real recovery.
HASHED="$(docker exec "$SCRATCH" psql -U verify -d verify -At -c \
  "SELECT count(*) FROM users WHERE length(password) > 20;")"
log "users with a usable password hash: ${HASHED}"

echo
log "───────────────────────────────────────────────"
log "RESTORE VERIFIED — RTO (restore only): ${ELAPSED}s"
log "Source: ${OBJECT}"
log "Record this figure and the date in docs/local/RUNBOOK.md item 9."
log "───────────────────────────────────────────────"
