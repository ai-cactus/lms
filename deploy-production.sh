#!/bin/bash
# deploy-production.sh
set -e

echo "➡️ Starting PRODUCTION deployment script..."
cd /home/homepc/lms2-production

echo "🔄 Fetching remote main..."
git checkout main
git fetch new-origin main
git reset --hard new-origin/main

echo "📦 Installing Node dependencies..."
npm install --legacy-peer-deps

echo "🗄️ Running database migrations..."
npx prisma migrate deploy

echo "⚡ Generating Prisma Client..."
npx prisma generate

echo "🏗️ Building production bundles..."
npm run build

echo "🔁 Restarting PM2 process for production..."
pm2 startOrRestart /home/homepc/lms2/ecosystem.config.js --only lms-production

echo "✨ Production updated, rebuilt, and restarted successfully!"
