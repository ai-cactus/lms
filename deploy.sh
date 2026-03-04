#!/bin/bash
set -e

# LMS2 Smart Deployer
# Usage: ./deploy.sh [staging|production] ["Commit message"]

ENV=$1
MSG=$2

if [ -z "$ENV" ]; then
    echo "Usage: ./deploy.sh [staging|production] [\"Your commit message\"]"
    exit 1
fi

BRANCH=$(git branch --show-current)

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
    
    if [ "$BRANCH" != "staging" ]; then
        echo "⚠️ Warning: You're on branch '$BRANCH', not 'staging'. Are you sure? (Press Ctrl+C to cancel)"
        sleep 3
    fi
    
    # Safely push to remotes (will fail if remote is ahead, protecting team's work)
    echo "⬆️ Pushing to remotes..."
    git push origin "$BRANCH:staging" || { echo "❌ Push to origin failed. Please pull first."; exit 1; }
    git push new-origin "$BRANCH:staging" || { echo "❌ Push to new-origin failed. Please pull first."; exit 1; }
    
    # Run staging deploy script
    ./deploy-staging.sh

elif [ "$ENV" == "production" ]; then
    echo "🚀 Deploying to PRODUCTION..."
    
    if [ "$BRANCH" != "staging" ] && [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
         echo "⚠️ Warning: You're deploying to production from branch '$BRANCH'. (Press Ctrl+C to cancel)"
         sleep 3
    fi
    
    # Update staging branch as well to keep it in sync
    echo "⬆️ Pushing local branch to staging remotes..."
    git push origin "$BRANCH:staging" || true
    git push new-origin "$BRANCH:staging" || true
    
    # Promote to production branches
    echo "🌟 Promoting to production (master/main) on remotes..."
    git push origin "$BRANCH:master" || { echo "❌ Promotion to origin master failed. Please pull first."; exit 1; }
    git push new-origin "$BRANCH:main" || { echo "❌ Promotion to new-origin main failed. Please pull first."; exit 1; }
    
    # Run production deploy script
    ./deploy-production.sh
else
    echo "❌ Invalid environment. Use 'staging' or 'production'."
    exit 1
fi

echo "✅ Deployment to $ENV complete! 🎉"
