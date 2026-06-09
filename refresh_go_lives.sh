#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:a:h}"
cd "$SCRIPT_DIR"

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

echo "Refreshing Go-Lives..."
python3 fetch_confluence_dashboard_data.py \
  --cql 'label in ("closed","closederp") and space = EPLPS and title !~ "TEMPLATE" and title !~ "TEST"' \
  --output dashboard/data/closed_projects.json \
  --skip-history \
  --incremental

cache_buster=$(python3 -c 'import json; from pathlib import Path; data=json.loads(Path("dashboard/data/closed_projects.json").read_text(encoding="utf-8")); print((data.get("generated_at") or "dev").replace(":","").replace("-","").replace("+","").replace(".",""))')
go_lives_url="http://127.0.0.1:8765/dashboard/go-lives.html"

echo "Updating cache-busting version tokens..."
perl -0pi -e "s/\\?v=[^\"]*/?v=${cache_buster}/g" \
  "$SCRIPT_DIR/dashboard/index.html" \
  "$SCRIPT_DIR/dashboard/go-lives.html" \
  "$SCRIPT_DIR/dashboard/changes.html"

echo "Starting local dashboard server..."
"$SCRIPT_DIR/start_dashboard_server.sh"

echo "Go-Lives refreshed at ${cache_buster}"
echo "Opening Go-Lives in your browser..."
open "${go_lives_url}?refresh=${cache_buster}"
