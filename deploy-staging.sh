#!/bin/bash
# deploy-staging.sh
cd /home/homepc/lms2
git checkout staging
git pull new-origin staging
pm2 startOrRestart ecosystem.config.js --only lms-staging
echo "Staging updated and restarted in Dev Mode."
