#!/bin/sh
# docker-entrypoint.sh — runs inside the LMS app container at startup.
#
# Responsibility: start the Next.js production server. That is all.
#
# ── Why migrations are NOT here any more ─────────────────────────────────────
# This used to run `prisma migrate deploy` before starting the server, so the
# schema always matched the running code even if a deploy step was skipped.
# That convenience carried two costs:
#
#   1. The app's own database credential had to be able to run DDL. That blocks
#      the least-privilege `lms_app` role (F-093) outright — and with a managed
#      database it would mean shipping a DDL-capable credential inside the app
#      container, which is precisely what the split exists to prevent.
#   2. Any container restart could alter the schema unattended. A 3am OOM
#      restart is not a good moment to apply a migration nobody is watching.
#
# Migrations now run as an explicit step in the deploy workflow, via the
# one-shot `migrate` service in docker-compose.<env>.yml, between "database is
# healthy" and "start the app".
#
# ⚠️ CONSEQUENCE: starting this stack outside the deploy workflow no longer
# applies migrations. Run them first:
#
#     docker compose -f docker-compose.<env>.yml --env-file .env.<env> \
#       --profile tools run --rm migrate
#
# CI is unaffected — the e2e job already runs `npx prisma migrate deploy`
# itself (.github/workflows/ci.yml) and never relied on this script.

set -e

# A command override runs INSTEAD of the server.
#
# Docker passes a container's `command` as ARGUMENTS to ENTRYPOINT, so a script
# that ignores "$@" silently discards them. Without this block, the compose
# `migrate` service's `prisma migrate deploy` was thrown away and a Next.js
# server started in its place — and because a server never exits, the deploy
# hung until the SSH step's 10-minute timeout and reported only "cancelled".
# That is exactly what happened to staging run 31814561810 on 2026-08-14.
#
# Honouring "$@" is also the conventional contract for an image entrypoint: it
# is what makes `docker run <image> sh` and any other override work at all.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "==> Starting Next.js server on port ${PORT:-3001}..."
exec ./node_modules/.bin/next start -p "${PORT:-3001}"
