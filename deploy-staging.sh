#!/bin/bash
# deploy-staging.sh
set -e

# Load user profile to ensure npm, node, and pm2 are dynamically injected in PATH
source ~/.bashrc || true
source ~/.profile || true
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "➡️ Starting STAGING deployment script..."
cd /home/homepc/lms2

echo "🔄 Fetching remote staging..."
git checkout staging
git fetch new-origin staging
git reset --hard new-origin/staging

echo "📦 Installing Node dependencies..."
npm install --legacy-peer-deps

echo "⚡ Generating Prisma Client..."
npx prisma generate

echo "🏗️ Building app for production..."
npm run build

echo "🔁 Restarting PM2 process for staging..."
pm2 startOrRestart ecosystem.config.js --only lms-staging

echo "✨ Staging updated and restarted successfully in Dev Mode!"
