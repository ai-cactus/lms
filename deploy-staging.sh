#!/bin/bash
# deploy-staging.sh
set -e

echo "➡️ Starting STAGING deployment script..."
cd /home/homepc/lms2-staging

echo "🔄 Fetching remote staging..."
git checkout staging
git fetch new-origin staging
git reset --hard new-origin/staging

echo "📦 Installing Node dependencies..."
npm install --legacy-peer-deps

echo "⚡ Generating Prisma Client..."
npx prisma generate

echo "🔁 Restarting PM2 process for staging..."
pm2 startOrRestart ecosystem.config.js --only lms-staging

echo "✨ Staging updated and restarted successfully in Dev Mode!"
