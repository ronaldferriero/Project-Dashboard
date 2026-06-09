# Confluence Project Dashboard

This project builds a local dashboard from Confluence project pages in the `EPLPS` space.

The current Confluence page you shared is a report page, not the source of truth. The real data lives on the individual project pages labeled with `status` and `erp`, so this project pulls those pages directly and extracts the implementation properties from each page.

## What it does

- Queries Confluence for active project pages in a space
- Fetches each page body in Atlassian document format
- Extracts the implementation table fields used by your dashboard
- Writes normalized JSON into `dashboard/data/projects.json`
- Writes normalized JSON into `dashboard/data/closed_projects.json` for the Go-Lives view
- Stores timestamped snapshots in `dashboard/data/history/`
- Writes a latest change report to `dashboard/data/project_changes.json`
- Emits browser-ready wrappers for change data in `dashboard/data/project_changes.js` and `dashboard/data/history/change_log.js`
- Regenerates `dashboard/data/projects.js` so the static dashboard can show fresh data when opened directly from disk
- Regenerates `dashboard/data/closed_projects.js` during refresh-on-run so the Go-Lives tab stays current too
- Serves the dashboard locally at `http://127.0.0.1:8765/dashboard/index.html`
- Allows project status updates from the Active Projects page when the dashboard is opened through the local server

## Setup

1. Create a virtual environment if you want one.
2. Install dependencies:

```bash
python3 -m pip install -r requirements.txt
```

3. Export credentials:

```bash
export CONFLUENCE_BASE_URL="https://tylertech.atlassian.net"
export CONFLUENCE_EMAIL="your-email@tylertech.com"
export CONFLUENCE_API_TOKEN="your-api-token"
```

4. Run the fetch:

```bash
python3 fetch_confluence_dashboard_data.py
```

5. Open the dashboard:

```bash
./start_dashboard_server.sh
open "http://127.0.0.1:8765/dashboard/index.html"
```

## Refresh On Run

Use the launcher below when you want the dashboard to refresh before it opens:

```bash
./refresh_dashboard.sh
```

That launcher now defaults to fast mode:
- it refreshes the active-project dataset used by the main dashboard and Changes tab using incremental comparison against the last snapshot
- it skips the closed-project Go-Lives dataset so the page opens much faster
- it starts the local dashboard server so interactive features like project-status write-back work

When you want everything refreshed, use:

```bash
./refresh_dashboard.sh --full
```

That full mode also refreshes the closed-project dataset used by the Go-Lives tab.
It also runs a full active-project rebuild instead of the incremental fast path.

On macOS you can also double-click [Run Dashboard.command](/Users/ronald.ferriero@tylertech.com/Library/CloudStorage/OneDrive-TylerTechnologies,Inc/CODEX%20PROJECTS/New%20Dashboard/Run%20Dashboard.command), which runs the same refresh-first flow.

If you keep credentials in a local `.env` file in the project root, the launcher will load it automatically before calling the fetch script.

For the Go-Lives page specifically, you can run a lightweight refresh that only checks for newly added closed projects:

```bash
./refresh_go_lives.sh
```

Or double-click [Refresh Go-Lives.command](/Users/ronald.ferriero@tylertech.com/Library/CloudStorage/OneDrive-TylerTechnologies,Inc/CODEX%20PROJECTS/New%20Dashboard/Refresh%20Go-Lives.command).

## Tests

```bash
python3 -m unittest tests/test_change_report.py
node tests/test_changes_ui.js
```

## Useful options

```bash
python3 fetch_confluence_dashboard_data.py --space EPLPS --limit 200
python3 fetch_confluence_dashboard_data.py --cql 'label in ("status","erp") and space = EPLPS'
python3 fetch_confluence_dashboard_data.py --output dashboard/data/projects.json
python3 fetch_confluence_dashboard_data.py --incremental --output dashboard/data/projects.json
python3 fetch_confluence_dashboard_data.py --cql 'label in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE" and title !~ "TEST"' --output dashboard/data/closed_projects.json --skip-history --incremental --new-only
python3 fetch_confluence_dashboard_data.py --cql 'label in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE" and title !~ "TEST"' --output dashboard/data/closed_projects.json --skip-history
```

## Notes

- The script currently assumes the project summary lives in the first implementation-info table on each project page.
- It also attempts to pull `2-month GLR`, `1-month GLR`, and `EUT` from a later table when present.
- Each refresh now keeps a historical snapshot in `dashboard/data/history/` and records added/removed/updated projects in `dashboard/data/project_changes.json`.
- The change report now includes richer project metadata for the Changes tab and marks whether the file is a full field-level comparison or only a summary placeholder.
- If your pages vary a lot in layout, we can harden the parser after we test with live data.
