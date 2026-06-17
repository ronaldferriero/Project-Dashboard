# Sales Handoff & New Project Forms - Setup Guide

## ⚠️ Important: Local Server Required

The **Sales Handoff** and **New Project** forms require the local Python dashboard server to function. These forms **will NOT work** on the GitHub Pages hosted version because they need backend API endpoints to create Confluence pages.

## How It Works

- **GitHub Pages** (https://ronaldferriero.github.io/Project-Dashboard/) - Read-only dashboard, forms display but cannot submit
- **Local Server** (http://127.0.0.1:8765/) - Full functionality including form submissions

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/ronaldferriero/Project-Dashboard.git
cd Project-Dashboard
```

### 2. Install Python Dependencies

```bash
python3 -m pip install -r requirements.txt
```

### 3. Configure Confluence Credentials

Create a `.env` file in the project root:

```bash
CONFLUENCE_BASE_URL=https://tylertech.atlassian.net
CONFLUENCE_EMAIL=your.email@tylertech.com
CONFLUENCE_API_TOKEN=your_api_token_here
```

**To get your Confluence API token:**
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a name (e.g., "Dashboard Forms")
4. Copy the token and paste it in your `.env` file

### 4. Start the Dashboard Server

```bash
./start_dashboard_server.sh
```

You should see:
```
Dashboard server running at http://127.0.0.1:8765
```

### 5. Open the Forms

In your browser, navigate to:

- **Sales Handoff Form**: http://127.0.0.1:8765/dashboard/sales-handoff.html
- **New Project Form**: http://127.0.0.1:8765/dashboard/new-project.html

## Usage

### Sales Handoff Document

1. Select an existing project from the dropdown
2. Fill out the sales handoff information
3. Submit - creates a child page under the selected project

### New Project

1. Fill out all required project information
2. Submit - creates a new project page with "status" and "erp" labels
3. Project appears in dashboard after running `./refresh_dashboard.sh`

## Troubleshooting

### "405 Method Not Allowed" Error

**Cause**: Trying to use the form on GitHub Pages or without the local server running.

**Solution**: 
1. Make sure the local server is running (`./start_dashboard_server.sh`)
2. Access via `http://127.0.0.1:8765/` NOT `github.io`

### "Server Not Responding" Error

**Cause**: Dashboard server is not running.

**Solution**:
```bash
./start_dashboard_server.sh
```

### Forms Display But Don't Work

**Cause**: You're on the GitHub Pages URL.

**Solution**: Use the local URL instead:
- ❌ https://ronaldferriero.github.io/Project-Dashboard/dashboard/sales-handoff.html
- ✅ http://127.0.0.1:8765/dashboard/sales-handoff.html

### Missing Confluence Credentials

**Cause**: `.env` file not configured.

**Solution**: Create `.env` file with your Confluence credentials (see step 3 above).

## Sharing with Team Members

To allow other team members to use these forms:

1. Share this setup guide
2. Each person needs to:
   - Clone the repository
   - Set up their own Confluence API token
   - Run the local server on their machine

**Note**: There's no way to share a single server - each person must run it locally because:
- Security: Confluence API tokens should not be shared or exposed
- Network: localhost (127.0.0.1) only accessible from that machine

## Alternative: Manual Process

If someone cannot set up the local server, they can:
1. View existing project pages in Confluence
2. Use the Confluence template pages directly
3. Copy/paste the Sales Handoff template manually

The forms are a convenience tool to speed up page creation, but everything can still be done manually in Confluence.

## Files

- `dashboard/sales-handoff.html` - Sales handoff form interface
- `dashboard/sales-handoff.js` - Sales handoff form logic
- `dashboard/new-project.html` - New project form interface
- `dashboard/new-project.js` - New project form logic
- `dashboard_server.py` - Backend server with API endpoints
- `SALES_HANDOFF_README.md` - Detailed sales handoff documentation
