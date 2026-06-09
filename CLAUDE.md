# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains two main projects:

1. **AWS Credential Management Tools**: Handles authentication for Claude Code integration with AWS Bedrock through Okta OIDC and AWS Cognito Identity Pool
2. **Confluence Project Dashboard**: A local web dashboard that pulls and visualizes project data from Confluence pages in the EPLPS space

## Architecture

The system consists of two main components:

1. **credential-process**: AWS credential provider that handles OIDC authentication flow through Okta and exchanges tokens via AWS Cognito Identity Pool for temporary AWS credentials
2. **otel-helper**: OpenTelemetry header generator that creates monitoring headers from authentication tokens

Both are distributed as pre-compiled binaries (Mach-O arm64 executables).

### Configuration

`config.json` stores the authentication configuration:
- `provider_domain`: Okta SSO domain (tylersso.okta.com)
- `client_id`: Okta OAuth client ID
- `identity_pool_id`: AWS Cognito Identity Pool ID for credential exchange
- `aws_region`: Primary AWS region (us-west-2)
- `provider_type`: Authentication provider (okta)
- `credential_storage`: Session-based credential caching
- `cross_region_profile`: Cross-region access profile name

### Credential Flow

1. User authenticates via Okta OIDC using `credential-process`
2. OIDC token is exchanged for AWS credentials via Cognito Identity Pool
3. Credentials are cached in the `cache/` directory
4. `otel-helper` generates OTEL headers from the authentication token for observability

## Common Commands

### Credential Management

```bash
# Get AWS credentials (default profile)
./credential-process

# Use specific profile
./credential-process --profile PROFILE_NAME

# Clear cached credentials and force re-authentication
./credential-process --clear-cache

# Get monitoring token instead of AWS credentials
./credential-process --get-monitoring-token

# Check version
./credential-process --version
```

### OpenTelemetry Helper

```bash
# Generate OTEL headers from token
./otel-helper

# Test mode with verbose output
./otel-helper --test

# Verbose output
./otel-helper --verbose
```

## Important Notes

- Credentials are cached in session storage in the `cache/` directory
- The binaries are macOS arm64 executables (Apple Silicon)
- Configuration uses Okta as the identity provider
- AWS region is us-west-2 with cross-region support via the "us" profile

---

## Confluence Project Dashboard

A Python-based dashboard that fetches project data from Confluence and serves it as an interactive local web application.

### Architecture

The dashboard consists of:

1. **Data Fetcher** (`fetch_confluence_dashboard_data.py`): Queries Confluence API for project pages, extracts implementation properties, and writes normalized JSON data
2. **Web Server** (`dashboard_server.py`): Serves the dashboard locally at `http://127.0.0.1:8765` and handles project status updates
3. **Frontend** (`dashboard/`): Static HTML/CSS/JS with multiple views:
   - Active Projects: Main dashboard with filtering, search, and metrics
   - Go-Lives: Projects that have completed implementation
   - At Risk: Projects flagged with risk indicators
   - Changes: Historical change tracking and comparison

### Data Flow

1. Fetch script queries Confluence for pages with `status` and `erp` labels in EPLPS space
2. Extracts implementation table data from each page's Atlassian document format
3. Writes data to:
   - `dashboard/data/projects.json` (active projects)
   - `dashboard/data/closed_projects.json` (completed projects)
   - `dashboard/data/history/` (timestamped snapshots)
   - `dashboard/data/project_changes.json` (change tracking)
4. Generates browser-ready JS wrappers for the dashboard to consume
5. Dashboard reads data files and renders interactive views

### Setup

```bash
# Install dependencies
python3 -m pip install -r requirements.txt

# Set Confluence credentials (use .env file or export)
export CONFLUENCE_BASE_URL="https://tylertech.atlassian.net"
export CONFLUENCE_EMAIL="your-email@tylertech.com"
export CONFLUENCE_API_TOKEN="your-api-token"
```

### Common Commands

```bash
# Quick launch (fast refresh + start server)
./refresh_dashboard.sh

# Full refresh (includes closed projects)
./refresh_dashboard.sh --full

# Refresh only Go-Lives data
./refresh_go_lives.sh

# Start server without refresh
./start_dashboard_server.sh

# Manual fetch (various options)
python3 fetch_confluence_dashboard_data.py --space EPLPS --limit 200
python3 fetch_confluence_dashboard_data.py --incremental
python3 fetch_confluence_dashboard_data.py --cql 'label in ("status","erp") and space = EPLPS'

# Run tests
python3 -m unittest tests/test_change_report.py
node tests/test_changes_ui.js
```

### macOS Launchers

- Double-click `Run Dashboard.command` to refresh and open dashboard
- Double-click `Refresh Go-Lives.command` to update Go-Lives data only

### Dashboard Features

- **Search & Filters**: Text search, status/manager/state filters, module multi-select
- **Metrics**: Portfolio snapshot with key statistics
- **Visual KPIs**: Chart grid showing project distribution by various dimensions
- **Export**: Export filtered project list
- **Change Tracking**: View historical changes with field-level comparison
- **Interactive Updates**: Update project status directly from the dashboard (when using local server)

### Important Notes

- Dashboard assumes project summary lives in the first implementation-info table on each page
- Incremental refresh compares against last snapshot for faster updates
- Full refresh includes closed projects; fast mode skips them for quicker startup
- Historical snapshots are preserved in `dashboard/data/history/`
- The local server enables write-back features for updating project status in the UI
