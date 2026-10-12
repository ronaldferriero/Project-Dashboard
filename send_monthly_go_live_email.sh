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
  echo "Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN in .env"
  exit 1
fi

if [[ -z "${SMTP_USER:-}" || -z "${SMTP_PASSWORD:-}" || -z "${GO_LIVE_EMAIL_TO:-}" ]]; then
  echo "Missing email credentials."
  echo "Set SMTP_USER, SMTP_PASSWORD, and GO_LIVE_EMAIL_TO in .env"
  exit 1
fi

echo "Refreshing active projects from Confluence..."
python3 fetch_confluence_dashboard_data.py --incremental

echo "Sending go-live email..."
python3 send_go_live_email.py --window-days 60

echo "Done."
