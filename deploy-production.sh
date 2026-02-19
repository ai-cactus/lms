#!/bin/bash
# deploy-production.sh
cd /home/homepc/lms2-production
git checkout main
git pull origin master
npm install --legacy-peer-deps
npx prisma migrate deploy
npm run build
pm2 startOrRestart /home/homepc/lms2/ecosystem.config.js --only lms-production
echo "Production updated, rebuilt, and restarted."
