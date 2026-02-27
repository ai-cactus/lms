# deploy-production.sh
set -e
cd /home/homepc/lms2-production
git checkout main
git pull new-origin main
npm install --legacy-peer-deps
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 startOrRestart /home/homepc/lms2/ecosystem.config.js --only lms-production
echo "Production updated, rebuilt, and restarted."
