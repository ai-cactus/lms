#!/bin/bash
# deploy-staging.sh
set -e
set -x # Extreme verbosity

echo "➡️ Starting STAGING deployment script logic..."

# Load user profile to ensure npm, node, and pm2 are dynamically injected in PATH
if [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc" || true; fi
if [ -f "$HOME/.profile" ]; then source "$HOME/.profile" || true; fi
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    \. "$NVM_DIR/nvm.sh"
else
    echo "⚠️ NVM not found at $NVM_DIR/nvm.sh"
fi

# Verify dependencies with full paths if possible
export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
echo "PATH is: $PATH"

command -v npm || { echo "❌ npm not found in PATH"; exit 1; }
command -v git || { echo "❌ git not found in PATH"; exit 1; }
command -v pm2 || { echo "❌ pm2 not found in PATH"; exit 1; }

cd /home/homepc/lms2 || { echo "❌ Could not cd to /home/homepc/lms2"; exit 1; }

echo "🔄 Git operations..."
git rev-parse --is-inside-work-tree || { echo "❌ Not a git repository"; exit 1; }

REMOTE="new-origin"
if ! git remote | grep -q "$REMOTE"; then
    echo "⚠️  $REMOTE not found, using 'origin'"
    REMOTE="origin"
fi

echo "Using remote: $REMOTE"
git fetch "$REMOTE" staging
git checkout -f staging
git reset --hard "$REMOTE/staging"
git status

echo "📦 Dependencies..."
npm install --legacy-peer-deps --no-audit --no-fund

echo "⚡ Prisma..."
npx prisma generate

echo "🏗️ Building..."
# Use a safer memory limit and clear Next cache if possible
rm -rf .next
NODE_OPTIONS="--max-old-space-size=2048" npm run build

echo "🔁 PM2 Restart..."
pm2 startOrRestart ecosystem.config.js --only lms-staging --env production

echo "✨ DONE!"
