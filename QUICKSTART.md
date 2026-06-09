# Quick Start Guide

This repository now contains the Confluence Project Dashboard from your CODEX project.

## Getting Started with the Dashboard

### 1. Install Dependencies

```bash
python3 -m pip install -r requirements.txt
```

### 2. Configure Credentials

Create a `.env` file in the project root:

```bash
CONFLUENCE_BASE_URL=https://tylertech.atlassian.net
CONFLUENCE_EMAIL=your-email@tylertech.com
CONFLUENCE_API_TOKEN=your-api-token
```

Or export them:

```bash
export CONFLUENCE_BASE_URL="https://tylertech.atlassian.net"
export CONFLUENCE_EMAIL="your-email@tylertech.com"
export CONFLUENCE_API_TOKEN="your-api-token"
```

### 3. Launch the Dashboard

**Option A: Quick Launch (Recommended)**
```bash
./refresh_dashboard.sh
```
This will:
- Refresh active projects data (incremental)
- Skip closed projects for faster startup
- Start the local server
- Open dashboard at http://127.0.0.1:8765/dashboard/index.html

**Option B: Full Refresh**
```bash
./refresh_dashboard.sh --full
```
Includes closed projects and runs full rebuild.

**Option C: Manual Steps**
```bash
# 1. Fetch data from Confluence
python3 fetch_confluence_dashboard_data.py

# 2. Start the server
./start_dashboard_server.sh

# 3. Open in browser
open "http://127.0.0.1:8765/dashboard/index.html"
```

**Option D: macOS Launcher**
- Double-click `Run Dashboard.command`

## Dashboard Views

Once running, you'll have access to:

- **Active Projects** (`index.html`) - Main dashboard with filters, search, and metrics
- **Go-Lives** (`go-lives.html`) - Projects that completed implementation
- **At Risk** (`risk.html`) - Projects with risk indicators
- **Changes** (`changes.html`) - Historical change tracking

## Project Structure

```
.
├── dashboard/                    # Frontend files
│   ├── index.html               # Active projects view
│   ├── go-lives.html            # Completed projects view
│   ├── risk.html                # At-risk projects view
│   ├── changes.html             # Change history view
│   ├── app.js                   # Main dashboard JavaScript
│   ├── styles.css               # Dashboard styling
│   └── data/                    # Generated data files
│       ├── projects.json        # Active projects data
│       ├── closed_projects.json # Completed projects data
│       ├── project_changes.json # Change tracking
│       └── history/             # Historical snapshots
├── fetch_confluence_dashboard_data.py  # Data fetcher
├── dashboard_server.py                  # Local web server
├── refresh_dashboard.sh                 # Quick launch script
├── start_dashboard_server.sh            # Server-only launcher
└── tests/                               # Test files
```

## Useful Fetch Options

```bash
# Incremental refresh (faster, only checks changed pages)
python3 fetch_confluence_dashboard_data.py --incremental

# Custom CQL query
python3 fetch_confluence_dashboard_data.py --cql 'label in ("status","erp") and space = EPLPS'

# Fetch closed projects only
python3 fetch_confluence_dashboard_data.py \
  --cql 'label in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE"' \
  --output dashboard/data/closed_projects.json \
  --skip-history

# Limit results
python3 fetch_confluence_dashboard_data.py --limit 200
```

## Testing

```bash
# Python tests
python3 -m unittest tests/test_change_report.py

# JavaScript tests
node tests/test_changes_ui.js
```

## See Also

- `DASHBOARD_README.md` - Full dashboard documentation
- `CLAUDE.md` - Complete repository guidance
