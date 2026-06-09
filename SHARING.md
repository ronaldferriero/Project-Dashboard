# Sharing the EPL ProServices Dashboard

This guide explains how to share the dashboard with internal Tyler Tech team members.

## 🌐 Sharing Options

### Option 1: Public GitHub Pages (Recommended for Internal Sharing)

**Best for:** Easy access for all Tyler Tech team members

1. Make the GitHub repository **private** (keeps code private)
2. Enable GitHub Pages as **public** (dashboard only)
3. Share the dashboard URL: `https://your-username.github.io/EPL_ProServices_Dashboard/dashboard/`

**Pros:**
- ✅ No GitHub account needed to view dashboard
- ✅ Easy to share - just send the link
- ✅ Source code remains private
- ✅ Data is already in Confluence (no new exposure)

**Cons:**
- ⚠️ Anyone with the URL can view (use obscure repo name if concerned)
- ⚠️ Data visible to public internet

### Option 2: Private Repository with Collaborators

**Best for:** Restricting access to specific team members

1. Keep repository **private**
2. Add team members as collaborators:
   - Go to Settings → Collaborators
   - Add Tyler Tech GitHub accounts
3. Share repository URL: `https://github.com/your-username/EPL_ProServices_Dashboard`

**Pros:**
- ✅ Complete access control
- ✅ Team members can see code and data
- ✅ Team members can contribute updates

**Cons:**
- ⚠️ Requires GitHub account for each viewer
- ⚠️ GitHub Pages may still be public

### Option 3: GitHub Organization/Team

**Best for:** Department-wide access

1. Create/use a Tyler Tech GitHub organization
2. Create team (e.g., "EPL-ProServices")
3. Add repository to team with read access
4. Team members automatically get access

**Pros:**
- ✅ Centralized access management
- ✅ Professional appearance
- ✅ Easy to onboard/offboard team members

**Cons:**
- ⚠️ Requires organization setup

### Option 4: Private GitHub Pages (GitHub Pro/Teams)

**Best for:** Maximum security

Requires GitHub Pro, Team, or Enterprise account.

1. Keep repository private
2. Enable private GitHub Pages
3. Only authenticated collaborators can access

## 📧 Sharing the Dashboard Link

Once deployed, share this with your team:

```
🎯 EPL ProServices Dashboard

View live project data from Confluence:
https://YOUR-USERNAME.github.io/EPL_ProServices_Dashboard/dashboard/

Features:
• Active Projects - Filter and search implementations
• Go-Lives - Completed projects
• At Risk - Projects with risk indicators  
• Changes - Historical tracking

Data refreshes: [Daily/Weekly/As needed]
Questions? Contact [Your Name]
```

## 🔒 Security Considerations

**What's in the dashboard:**
- Project names and details from Confluence
- Project manager and implementation manager names
- Timeline and status information
- All data is already in Confluence (Tyler Tech internal)

**What's NOT included:**
- No authentication credentials
- No API tokens
- No sensitive configuration

**Recommendation for internal sharing:**
- ✅ Public GitHub Pages is fine - data is already internal
- ✅ Keep repository private to protect credential files
- ✅ Use `.env` file for secrets (already in `.gitignore`)

## 👥 Adding Collaborators

To give someone access to update/maintain the dashboard:

```bash
# On GitHub.com
Settings → Collaborators → Add people
Enter their GitHub username
Select role: Write (can push updates)
```

## 📱 Mobile Access

The dashboard is mobile-responsive. Team members can:
- Bookmark on mobile devices
- Add to home screen (PWA-like)
- Access from tablets in the field

## 🔄 Keeping Data Fresh

Remind team members:
- Dashboard shows snapshot from last update
- Check timestamp at top of page
- Contact you to request manual refresh
- Or: Set up auto-refresh via GitHub Actions

## ❓ Troubleshooting

**"I can't access the dashboard"**
- Check if GitHub Pages is enabled
- Verify the URL is correct (include `/dashboard/` at end)
- Wait 2-3 minutes after enabling Pages

**"The data is outdated"**
- Run `./publish-update.sh` to refresh
- Or enable GitHub Actions auto-update

**"Can I edit project data?"**
- Dashboard is read-only
- Edit data in Confluence, then refresh dashboard
- Local server mode allows status updates (development only)
