#!/bin/bash
# deploy-staging.sh
cd /home/homepc/lms2
git checkout staging
git pull origin staging
pm2 restart lms-staging
echo "Staging updated and restarted in Dev Mode."
