# EPL ProServices Dashboard

A live dashboard for tracking Tyler Technologies EPL Professional Services projects from Confluence.

## 🔗 Live Dashboard

Visit the live dashboard: **[View Dashboard](https://your-username.github.io/EPL_ProServices_Dashboard/dashboard/)**

*(Update this link with your actual GitHub username after deploying)*

## 📊 Features

- **Active Projects View** - Filter and search active implementations
- **Go-Lives** - Track completed project implementations
- **At Risk** - Monitor projects with risk indicators
- **Changes** - View historical changes and comparisons
- **Interactive Filters** - By status, manager, state, modules, and more
- **Portfolio Metrics** - Key statistics and visual KPIs
- **Export** - Download filtered project lists

## 🛠️ Local Development

### Prerequisites

- Python 3.x
- Confluence API access (credentials)

### Setup

1. Clone this repository:
```bash
git clone https://github.com/your-username/EPL_ProServices_Dashboard.git
cd EPL_ProServices_Dashboard
```

2. Install dependencies:
```bash
python3 -m pip install -r requirements.txt
```

3. Configure Confluence credentials:
```bash
export CONFLUENCE_BASE_URL="https://tylertech.atlassian.net"
export CONFLUENCE_EMAIL="your-email@tylertech.com"
export CONFLUENCE_API_TOKEN="your-api-token"
```

Or create a `.env` file with these variables.

4. Launch the dashboard:
```bash
./refresh_dashboard.sh
```

The dashboard will open at `http://127.0.0.1:8765/dashboard/index.html`

## 📝 Updating the Live Dashboard

To refresh the live dashboard with latest Confluence data:

```bash
./publish-update.sh
```

This will:
1. Fetch fresh data from Confluence
2. Commit changes to git
3. Push to GitHub
4. Auto-deploy to GitHub Pages (1-2 min)

## 📖 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Quick setup guide
- **[SHARING.md](SHARING.md)** - How to share with team members
- **[DASHBOARD_README.md](DASHBOARD_README.md)** - Detailed dashboard documentation
- **[CLAUDE.md](CLAUDE.md)** - Full repository guidance

## 🏗️ Architecture

This dashboard pulls data from Confluence project pages labeled with `status` and `erp` in the EPLPS space, extracts implementation properties, and presents them in an interactive web interface.

**Components:**
- `fetch_confluence_dashboard_data.py` - Data fetcher
- `dashboard_server.py` - Local development server
- `dashboard/` - Static web dashboard (HTML/CSS/JS)

## 🔐 AWS Credential Tools

This repository also includes AWS credential management tools for Claude Code integration with AWS Bedrock through Okta OIDC authentication. See [CLAUDE.md](CLAUDE.md) for details.

## 📄 License

Internal Tyler Technologies tool.
