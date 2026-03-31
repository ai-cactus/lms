#!/bin/sh
# docker-entrypoint.sh — runs inside the LMS app container at startup.
#
# Responsibility:
#   1. Apply any pending database migrations (idempotent, safe to re-run).
#   2. Hand off to the Next.js production server.
#
# Why here and not in CI/CD?
#   Running migrations in the entrypoint guarantees the schema is always in
#   sync with the code that is actually running, even if a deploy step is
#   partially skipped. prisma migrate deploy is idempotent — if all migrations
#   are already applied it exits immediately (< 1s overhead).

set -e

echo "==> [1/2] Running database migrations..."
./node_modules/.bin/prisma migrate deploy
echo "==> Migrations complete."

echo "==> [2/2] Starting Next.js server on port ${PORT:-3001}..."
exec ./node_modules/.bin/next start -p "${PORT:-3001}"
