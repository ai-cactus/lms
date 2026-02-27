#!/bin/bash

# LMS2 Unified Deployer
# Usage: ./deploy.sh [staging|production] "Commit message"

ENV=$1
MSG=$2

if [ -z "$ENV" ] || [ -z "$MSG" ]; then
    echo "Usage: ./deploy.sh [staging|production] \"Your commit message\""
    exit 1
fi

# 1. Commit changes
echo "Committing changes..."
git add .
git commit -m "$MSG"

if [ "$ENV" == "staging" ]; then
    echo "Deploying to STAGING..."
    # Push to staging branch
    git push origin staging
    git push new-origin staging
    # Run staging deploy script
    ./deploy-staging.sh

elif [ "$ENV" == "production" ]; then
    echo "Deploying to PRODUCTION..."
    # Sync staging to master
    git push origin staging:master
    # Sync staging to main on new-origin
    git push new-origin staging:main
    # Run production deploy script
    ./deploy-production.sh
else
    echo "Invalid environment. Use 'staging' or 'production'."
    exit 1
fi

echo "Deployment to $ENV complete! 🚀"
