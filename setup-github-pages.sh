#!/bin/bash

# Setup script for GitHub Pages deployment
# This will guide you through initializing git and pushing to GitHub

set -e

echo "🚀 GitHub Pages Setup for Confluence Dashboard"
echo "=============================================="
echo ""

# Check if git is initialized
if [ -d .git ]; then
  echo "✅ Git repository already initialized"
else
  echo "📦 Initializing git repository..."
  git init
  echo "✅ Git initialized"
fi

echo ""
echo "⚙️  Configuring git..."

# Get git user info
CURRENT_NAME=$(git config user.name 2>/dev/null || echo "")
CURRENT_EMAIL=$(git config user.email 2>/dev/null || echo "")

if [ -z "$CURRENT_NAME" ]; then
  read -p "Enter your name for git commits: " GIT_NAME
  git config user.name "$GIT_NAME"
else
  echo "   Git user name: $CURRENT_NAME"
fi

if [ -z "$CURRENT_EMAIL" ]; then
  read -p "Enter your email for git commits: " GIT_EMAIL
  git config user.email "$GIT_EMAIL"
else
  echo "   Git user email: $CURRENT_EMAIL"
fi

echo ""
echo "📝 Adding files to git..."
git add .

echo ""
echo "💾 Creating initial commit..."
git commit -m "Initial commit: EPL ProServices Dashboard" || echo "Commit created or already exists"

echo ""
echo "=============================================="
echo "🌐 Next Steps:"
echo "=============================================="
echo ""
echo "1. Create a new repository on GitHub:"
echo "   → Go to https://github.com/new"
echo "   → Name it: EPL_ProServices_Dashboard"
echo "   → Make it PUBLIC or PRIVATE (your choice for sharing)"
echo "   → Do NOT initialize with README (we already have one)"
echo ""
echo "2. After creating the repo, run these commands:"
echo ""
echo "   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "3. Enable GitHub Pages:"
echo "   → Go to your repo settings"
echo "   → Click 'Pages' in the left sidebar"
echo "   → Under 'Source', select 'Deploy from a branch'"
echo "   → Select branch: main"
echo "   → Select folder: /root"
echo "   → Click Save"
echo ""
echo "4. Configure the dashboard path:"
echo "   → Your site will be at: https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/"
echo "   → The dashboard will be at: https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/dashboard/"
echo ""
echo "5. Update the README.md with your actual GitHub Pages URL"
echo ""
echo "6. To update the live dashboard later, just run:"
echo "   ./publish-update.sh"
echo ""
echo "=============================================="
echo "📢 SHARING OPTIONS:"
echo "   • Private repo: Share via GitHub team/collaborators"
echo "   • Public repo: Anyone with link can view dashboard"
echo "   • GitHub Pages can be public even with private repo"
echo "=============================================="
