#!/bin/bash
# deploy-production.sh
cd /home/homepc/lms2-production
git checkout main
git pull origin main
npm install --legacy-peer-deps
npx prisma migrate deploy
npm run build
pm2 restart lms-production
echo "Production updated, rebuilt, and restarted."
