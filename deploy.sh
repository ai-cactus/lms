#!/bin/bash
set -e

# LMS2 Smart Deployer (Workflow V2)
# Usage: ./deploy.sh [staging|production] ["Commit message"]

ENV=$1
MSG=$2

if [ -z "$ENV" ]; then
    echo "Usage: ./deploy.sh [staging|production] [\"Your commit message\"]"
    exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)

# 1. Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    if [ -z "$MSG" ]; then
        echo "Error: You have uncommitted changes but didn't provide a commit message."
        echo "Usage: ./deploy.sh $ENV \"Your commit message\""
        exit 1
    fi
    echo "📦 Committing changes..."
    git add .
    git commit -m "$MSG"
else
    echo "✨ Working directory is clean. No need to commit."
    if [ -n "$MSG" ]; then
        echo "📝 Note: Commit message provided but ignored since there are no changes."
    fi
fi

if [ "$ENV" == "staging" ]; then
    echo "🚀 Deploying to STAGING..."
    echo "Pipeline: branch -> dev -> staging"
    
    if [ "$CURRENT_BRANCH" != "dev" ]; then
        echo "❌ Error: Staging deployments MUST start from 'dev'."
        echo "Please switch to dev, pull the latest changes, and try again:"
        echo "  git checkout dev && git pull && ./deploy.sh staging"
        exit 1
    fi
    
    echo "⬇️ Pulling latest dev from remotes to ensure we are up to date..."
    git pull new-origin dev || { echo "❌ Failed to pull latest dev."; exit 1; }
    
    # Safely push dev to staging branches
    echo "⬆️ Pushing local dev to staging remotes..."
    git push origin dev:staging || { echo "❌ Push to origin failed. Please pull first."; exit 1; }
    git push new-origin dev:staging || { echo "❌ Push to new-origin failed. Please pull first."; exit 1; }
    
    # Run staging deploy script
    ./deploy-staging.sh

elif [ "$ENV" == "production" ]; then
    echo "🚀 Deploying to PRODUCTION..."
    echo "Pipeline: staging -> production (main)"
    
    if [ "$CURRENT_BRANCH" != "staging" ] && [ "$CURRENT_BRANCH" != "dev" ] && [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
         echo "⚠️ Warning: You're deploying to production from branch '$CURRENT_BRANCH'."
         echo "Normally production is deployed from staging or dev. Press Ctrl+C to cancel within 5 seconds."
         sleep 5
    fi
    
    # Promote current state to production branches
    echo "🌟 Promoting to production (master/main) on remotes..."
    git push origin "$CURRENT_BRANCH:master" || { echo "❌ Promotion to origin master failed. Please pull first."; exit 1; }
    git push new-origin "$CURRENT_BRANCH:main" || { echo "❌ Promotion to new-origin main failed. Please pull first."; exit 1; }
    
    # Run production deploy script
    ./deploy-production.sh
else
    echo "❌ Invalid environment. Use 'staging' or 'production'."
    exit 1
fi

echo "✅ Deployment to $ENV complete! 🎉"
