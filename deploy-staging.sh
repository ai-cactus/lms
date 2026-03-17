#!/bin/bash
# deploy-staging.sh
set -e
set -x # Enable command tracing for debugging in GitHub Action logs

# Load user profile to ensure npm, node, and pm2 are dynamically injected in PATH
source ~/.bashrc || true
source ~/.profile || true
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "➡️ Starting STAGING deployment script..."

# Verify dependencies
command -v npm >/dev/null 2>&1 || { echo >&2 "❌ npm is not installed. Aborting."; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo >&2 "❌ pm2 is not installed. Aborting."; exit 1; }

cd /home/homepc/lms2

echo "🔄 Fetching remote staging..."
REMOTE="new-origin"
if ! git remote | grep -q "$REMOTE"; then
    echo "⚠️  $REMOTE not found, falling back to 'origin'"
    REMOTE="origin"
fi

git checkout staging
git fetch "$REMOTE" staging
git reset --hard "$REMOTE/staging"

echo "📦 Installing Node dependencies..."
npm install --legacy-peer-deps

echo "⚡ Generating Prisma Client..."
npx prisma generate

echo "🏗️ Building app for production..."
# Increase memory limit for Next.js build
NODE_OPTIONS="--max-old-space-size=4096" npm run build

echo "🔁 Restarting PM2 process for staging..."
pm2 startOrRestart ecosystem.config.js --only lms-staging

echo "✨ Staging updated and restarted successfully!"
