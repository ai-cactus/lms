#!/bin/bash
# deploy-production.sh
#
# Runs on the GCP VM as the `deploy` user, invoked by GitHub Actions.
# Assumes:
#   - Node 24 is installed system-wide
#   - PM2 is installed globally
#   - App directory: /home/deploy/apps/lms-production
#   - .env file is pre-placed at /home/deploy/apps/lms-production/.env
#
# Usage: bash deploy-production.sh

set -euo pipefail

APP_DIR="/home/deploy/apps/lms-production"
LOG_PREFIX="[lms-production]"
ECOSYSTEM_CONFIG="/home/deploy/apps/lms-production/ecosystem.config.js"

log()  { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') INFO  $LOG_PREFIX $*"; }
error(){ echo "$(date '+%Y-%m-%dT%H:%M:%S%z') ERROR $LOG_PREFIX $*" >&2; exit 1; }

# ── 1. Sanity checks ─────────────────────────────────────────────────────────
log "Starting production deployment"

command -v node >/dev/null 2>&1 || error "node not found in PATH"
command -v npm  >/dev/null 2>&1 || error "npm not found in PATH"
command -v pm2  >/dev/null 2>&1 || error "pm2 not found in PATH"

[ -d "$APP_DIR" ]           || error "App directory $APP_DIR not found"
[ -f "$APP_DIR/.env" ]      || error ".env not found at $APP_DIR/.env — place it manually and re-run"
[ -f "$ECOSYSTEM_CONFIG" ]  || error "ecosystem.config.js not found at $ECOSYSTEM_CONFIG"

# ── 2. Pull latest code ───────────────────────────────────────────────────────
log "Pulling latest code from main branch"
cd "$APP_DIR"

# GH_PAT_READ is injected as an SSH env var by GitHub Actions.
# We use it inline for the fetch and never write it to disk.
if [ -z "${GH_PAT_READ:-}" ]; then
  error "GH_PAT_READ env var is not set. Cannot pull from GitHub."
fi

# Temporarily use HTTPS with token for fetch, then restore clean remote URL
git remote set-url origin "https://oauth2:${GH_PAT_READ}@github.com/ai-cactus/lms.git"
git fetch origin main
git remote set-url origin "https://github.com/ai-cactus/lms.git"  # strip token from config

git checkout -f main
git reset --hard origin/main

log "Now at commit: $(git rev-parse --short HEAD) — $(git log -1 --pretty=format:'%s')"

# ── 3. Install dependencies ───────────────────────────────────────────────────
log "Installing Node dependencies"
npm install --legacy-peer-deps --no-audit --no-fund

# ── 4. Database migrations ────────────────────────────────────────────────────
# `prisma migrate deploy` is safe for production — it applies only pending
# migrations and never resets data. Runs before the build intentionally so a
# failed migration aborts the deploy before a new binary is served.
log "Running database migrations"
npx prisma migrate deploy

# ── 5. Generate Prisma client ─────────────────────────────────────────────────
log "Generating Prisma client"
npx prisma generate

# ── 6. Build ──────────────────────────────────────────────────────────────────
log "Building application (this may take a few minutes)"
rm -rf .next

# 6 GB limit — leaves 2 GB headroom for staging + OS on an 8 GB VM
NODE_OPTIONS="--max-old-space-size=6144" npm run build

# ── 7. Zero-downtime reload ───────────────────────────────────────────────────
log "Reloading PM2 process (zero-downtime)"
pm2 reload "$ECOSYSTEM_CONFIG" --only lms-production --update-env

pm2 save

# ── 8. Health check ───────────────────────────────────────────────────────────
log "Waiting for app to become healthy..."
MAX_RETRIES=12
RETRY_INTERVAL=5

for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then
    log "Health check passed ✓"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    error "Health check failed after $((MAX_RETRIES * RETRY_INTERVAL))s — check PM2 logs: pm2 logs lms-production"
  fi
  log "Waiting... ($i/$MAX_RETRIES)"
  sleep $RETRY_INTERVAL
done

log "Production deployment complete ✓"
log "Commit: $(git rev-parse HEAD)"
