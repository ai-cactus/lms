#!/bin/bash
# deploy-staging.sh
#
# Runs on the GCP VM as the `deploy` user, invoked by GitHub Actions.
# Assumes:
#   - Node 24 is installed system-wide (/usr/bin/node or /usr/local/bin/node)
#   - PM2 is installed globally
#   - App directory: /home/deploy/apps/lms-staging
#   - .env file is pre-placed at /home/deploy/apps/lms-staging/.env
#
# Usage: bash deploy-staging.sh

set -euo pipefail

APP_DIR="/home/deploy/apps/lms-staging"
LOG_PREFIX="[lms-staging]"
ECOSYSTEM_CONFIG="/home/deploy/apps/lms-staging/ecosystem.config.js"

log()  { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') INFO  $LOG_PREFIX $*"; }
error(){ echo "$(date '+%Y-%m-%dT%H:%M:%S%z') ERROR $LOG_PREFIX $*" >&2; exit 1; }

# ── 1. Sanity checks ─────────────────────────────────────────────────────────
log "Starting staging deployment"

command -v node >/dev/null 2>&1 || error "node not found in PATH"
command -v npm  >/dev/null 2>&1 || error "npm not found in PATH"
command -v pm2  >/dev/null 2>&1 || error "pm2 not found in PATH"

[ -d "$APP_DIR" ]           || error "App directory $APP_DIR not found"
[ -f "$APP_DIR/.env" ]      || error ".env not found at $APP_DIR/.env — place it manually and re-run"
[ -f "$ECOSYSTEM_CONFIG" ]  || error "ecosystem.config.js not found at $ECOSYSTEM_CONFIG"

# ── 2. Pull latest code ───────────────────────────────────────────────────────
log "Pulling latest code from staging branch"
cd "$APP_DIR"

# GH_PAT_READ is injected as an SSH env var by GitHub Actions.
# We use it inline for the fetch and never write it to disk.
if [ -z "${GH_PAT_READ:-}" ]; then
  error "GH_PAT_READ env var is not set. Cannot pull from GitHub."
fi

# Temporarily use HTTPS with token for fetch, then restore clean remote URL
git remote set-url origin "https://oauth2:${GH_PAT_READ}@github.com/ai-cactus/lms.git"
git fetch origin staging
git remote set-url origin "https://github.com/ai-cactus/lms.git"  # strip token from config

git checkout -f staging
git reset --hard origin/staging

log "Now at commit: $(git rev-parse --short HEAD) — $(git log -1 --pretty=format:'%s')"

# ── 3. Install dependencies ───────────────────────────────────────────────────
log "Installing Node dependencies"
npm install --legacy-peer-deps --no-audit --no-fund

# ── 4. Database migrations ────────────────────────────────────────────────────
log "Running database migrations"
npx prisma migrate deploy

# ── 5. Generate Prisma client ─────────────────────────────────────────────────
log "Generating Prisma client"
npx prisma generate

# ── 6. Build ──────────────────────────────────────────────────────────────────
log "Building application (this may take a few minutes)"
# Clear previous build artefacts to prevent stale cache issues
rm -rf .next

# Limit memory to 6 GB — leaves 2 GB headroom on an 8 GB VM
NODE_OPTIONS="--max-old-space-size=6144" npm run build

# ── 7. Zero-downtime reload ───────────────────────────────────────────────────
log "Reloading PM2 process (zero-downtime)"
# `pm2 reload` performs a rolling restart within the cluster — processes stay
# up while new ones spin up, so requests are never dropped.
pm2 reload "$ECOSYSTEM_CONFIG" --only lms-staging --update-env

pm2 save

# ── 8. Health check ───────────────────────────────────────────────────────────
log "Waiting for app to become healthy..."
MAX_RETRIES=12
RETRY_INTERVAL=5

for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf http://localhost:3001 >/dev/null 2>&1; then
    log "Health check passed ✓"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    error "Health check failed after $((MAX_RETRIES * RETRY_INTERVAL))s — check PM2 logs: pm2 logs lms-staging"
  fi
  log "Waiting... ($i/$MAX_RETRIES)"
  sleep $RETRY_INTERVAL
done

log "Staging deployment complete ✓"
log "Commit: $(git rev-parse HEAD)"
