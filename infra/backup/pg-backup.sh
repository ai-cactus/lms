#!/usr/bin/env bash
#
# Nightly logical backup of an LMS Postgres database to Google Cloud Storage.
#
# ── Why a logical dump, when the plan calls for pgBackRest ────────────────────
# Continuous WAL archiving needs `archive_command` running INSIDE the database
# container, which means a custom image and a Postgres restart. This script
# needs neither, so it closes the "no backups exist at all" hole today. It is
# Phase 1, not the destination: RPO here is "since last night". pgBackRest and
# point-in-time recovery follow in Phase 2 — see README.md.
#
# ── Why the work happens through Docker ──────────────────────────────────────
# pg_dump runs via `docker exec` (the exact server version, no client/server
# mismatch) and the upload runs in a throwaway google/cloud-sdk container, so
# the VM needs nothing installed but Docker, which is already there.
#
# ── The failure mode this is built around ────────────────────────────────────
# A backup job that silently stops is worse than none, because it buys false
# confidence. Two defences: a non-zero exit that systemd surfaces via
# OnFailure, and a `_last_success` heartbeat object written to the bucket.
# The heartbeat is checkable from OUTSIDE the VM — which matters, because the
# scenario being insured against is the VM not being there to complain.
#
# Usage: pg-backup.sh <production|staging>

set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  production | staging) ;;
  *)
    echo "usage: $0 <production|staging>" >&2
    exit 2
    ;;
esac

CONTAINER="lms-${ENVIRONMENT}-db"
ENV_FILE="/home/deploy/apps/lms-${ENVIRONMENT}/.env.${ENVIRONMENT}"
KEY_FILE="/home/deploy/secrets/backup-sa-${ENVIRONMENT}.json"
BUCKET="${BACKUP_BUCKET:-gs://theraptly-lms-backups-${ENVIRONMENT}}"
STAGE_DIR="/home/deploy/backups/${ENVIRONMENT}"
# Refuse to start unless the dump has somewhere to land. The VM hit 98% disk on
# 2026-08-11; a backup that fills the disk takes the database down with it.
MIN_FREE_MB="${MIN_FREE_MB:-2048}"
SDK_IMAGE="google/cloud-sdk:slim"

log() { echo "[pg-backup][${ENVIRONMENT}] $*"; }
fail() {
  echo "[pg-backup][${ENVIRONMENT}] ERROR: $*" >&2
  exit 1
}

# ── Preflight ────────────────────────────────────────────────────────────────
[ -f "$ENV_FILE" ] || fail "env file not found: $ENV_FILE"
[ -f "$KEY_FILE" ] || fail "backup service-account key not found: $KEY_FILE"
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "container not running: $CONTAINER"

# Read only the two values needed. Never echo the file — it holds every secret.
PG_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
PG_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
PG_USER="${PG_USER:-lms}"
PG_DB="${PG_DB:-lms_${ENVIRONMENT}}"

mkdir -p "$STAGE_DIR"
FREE_MB="$(df -Pm "$STAGE_DIR" | awk 'NR==2 {print $4}')"
[ "$FREE_MB" -ge "$MIN_FREE_MB" ] || fail "only ${FREE_MB}MB free at ${STAGE_DIR}, need ${MIN_FREE_MB}MB"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_NAME="${PG_DB}-${STAMP}.dump"
DUMP_PATH="${STAGE_DIR}/${DUMP_NAME}"

# Always clear the staging copy, including on failure — a half-written dump left
# behind is both a disk leak and a restore trap.
cleanup() { rm -f "$DUMP_PATH"; }
trap cleanup EXIT

# ── Dump ─────────────────────────────────────────────────────────────────────
# -Fc (custom format) rather than plain SQL: compressed, and pg_restore can
# then restore selectively and in parallel, which is what makes the RTO
# measured by restore-verify.sh meaningful.
log "dumping ${PG_DB} from ${CONTAINER}"
docker exec -u postgres "$CONTAINER" \
  pg_dump -U "$PG_USER" -d "$PG_DB" -Fc -Z 6 >"$DUMP_PATH" ||
  fail "pg_dump failed"

[ -s "$DUMP_PATH" ] || fail "dump is empty"

# Parse the archive's own table of contents. This is the cheapest available
# proof that the file is a valid, complete pg_dump archive rather than a
# truncated stream that happens to be non-empty.
docker run --rm -v "$STAGE_DIR:/backups:ro" pgvector/pgvector:pg16 \
  pg_restore --list "/backups/${DUMP_NAME}" >/dev/null 2>&1 ||
  fail "dump failed its integrity check (pg_restore --list could not read it)"

SIZE_MB="$(du -m "$DUMP_PATH" | cut -f1)"
log "dump ok: ${DUMP_NAME} (${SIZE_MB}MB)"

# ── Upload ───────────────────────────────────────────────────────────────────
# Uploaded to inflight/ first, then moved. A GCS object only becomes visible at
# its final name once it is complete, so a run killed mid-upload can never leave
# something that looks like a usable backup.
DEST_FINAL="${BUCKET}/postgres/${STAMP:0:4}/${DUMP_NAME}"
DEST_INFLIGHT="${BUCKET}/inflight/${DUMP_NAME}"

log "uploading to ${DEST_FINAL}"
docker run --rm \
  -v "$KEY_FILE:/key.json:ro" \
  -v "$STAGE_DIR:/backups:ro" \
  "$SDK_IMAGE" \
  sh -c "
    set -e
    gcloud auth activate-service-account --key-file=/key.json --quiet
    gcloud storage cp '/backups/${DUMP_NAME}' '${DEST_INFLIGHT}' --quiet
    gcloud storage mv '${DEST_INFLIGHT}' '${DEST_FINAL}' --quiet
    printf '%s' '${STAMP}' | gcloud storage cp - '${BUCKET}/_last_success' --quiet
  " || fail "upload failed"

log "backup complete: ${DEST_FINAL}"
