#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:a:h}"
cd "$SCRIPT_DIR"

full_refresh=0
skip_open=0
skip_server=0
active_args=()
for arg in "$@"; do
  if [[ "$arg" == "--full" ]]; then
    full_refresh=1
  elif [[ "$arg" == "--no-open" ]]; then
    skip_open=1
  elif [[ "$arg" == "--skip-server" ]]; then
    skip_server=1
  else
    active_args+=("$arg")
  fi
done

if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

if [[ -z "${CONFLUENCE_EMAIL:-}" || -z "${CONFLUENCE_API_TOKEN:-}" ]]; then
  echo "Missing Confluence credentials."
  echo "Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN in your shell or in a local .env file."
  exit 1
fi

echo "Refreshing active projects..."
if [[ "$full_refresh" -eq 1 ]]; then
  python3 fetch_confluence_dashboard_data.py "${active_args[@]}"
else
  python3 fetch_confluence_dashboard_data.py --incremental "${active_args[@]}"
fi

if [[ "$full_refresh" -eq 1 ]]; then
  echo "Refreshing closed projects for Go-Lives..."
  python3 fetch_confluence_dashboard_data.py \
    --cql 'label in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE" and title !~ "TEST"' \
    --output dashboard/data/closed_projects.json \
    --skip-history
else
  echo "Skipping Go-Lives refresh in fast mode. Use --full to refresh closed projects too."
fi

cache_buster=$(python3 -c 'import json; from pathlib import Path; data=json.loads(Path("dashboard/data/projects.json").read_text(encoding="utf-8")); print((data.get("generated_at") or "dev").replace(":","").replace("-","").replace("+","").replace(".",""))')
dashboard_url="http://127.0.0.1:8765/dashboard/index.html"

echo "Updating cache-busting version tokens..."
perl -0pi -e "s/\\?v=[^\"]*/?v=${cache_buster}/g" \
  "$SCRIPT_DIR/dashboard/index.html" \
  "$SCRIPT_DIR/dashboard/go-lives.html" \
  "$SCRIPT_DIR/dashboard/changes.html"

if [[ "$skip_server" -eq 0 ]]; then
  echo "Starting local dashboard server..."
  "$SCRIPT_DIR/start_dashboard_server.sh"
else
  echo "Skipping local dashboard server restart."
fi

echo "Dashboard refreshed at ${cache_buster}"
if [[ "$skip_open" -eq 0 ]]; then
  echo "Opening dashboard in your browser..."
  open "${dashboard_url}?refresh=${cache_buster}"
else
  echo "Skipping browser open."
fi
