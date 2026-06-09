#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:a:h}"
LOG_FILE="/tmp/new_dashboard_refresh.log"
DASHBOARD_URL="http://127.0.0.1:8765/dashboard/index.html"

echo "Starting dashboard server..."
if "$SCRIPT_DIR/start_dashboard_server.sh"; then
  echo
  echo "Opening dashboard immediately..."
  open "$DASHBOARD_URL"
else
  exit_code=$?
  echo
  echo "Dashboard server failed to start with exit code ${exit_code}."
  echo "Press Return to close this window."
  read
  exit "$exit_code"
fi

echo
echo "Refreshing data in background..."
nohup "$SCRIPT_DIR/refresh_dashboard.sh" --no-open --skip-server >"$LOG_FILE" 2>&1 &
refresh_pid=$!
echo "Background refresh PID: ${refresh_pid}"
echo "Refresh log: $LOG_FILE"
echo "Reload the page in a minute to pick up fresh data."

echo
echo "Press Return to close this window."
read
