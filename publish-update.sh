#!/bin/bash

# Refresh and publish dashboard data
# Usage: ./publish-update.sh [commit-message]

set -e

echo "📊 Fetching latest data from Confluence..."
./refresh_dashboard.sh --full

echo ""
echo "📦 Committing changes..."
git add dashboard/data/

if [ -z "$1" ]; then
  COMMIT_MSG="Update dashboard data - $(date '+%Y-%m-%d %H:%M')"
else
  COMMIT_MSG="$1"
fi

if git diff --staged --quiet; then
  echo "✅ No changes to commit - data is already up to date"
  exit 0
fi

git commit -m "$COMMIT_MSG"

echo ""
echo "🚀 Pushing to remote..."
git push

echo ""
echo "✅ Done! Your static site will update in 1-2 minutes."
echo "   Check your hosting provider's deployment status."
