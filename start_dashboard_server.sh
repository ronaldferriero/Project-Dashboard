#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:a:h}"
cd "$SCRIPT_DIR"

HOST="127.0.0.1"
PORT="8765"
PID_FILE="/tmp/new_dashboard_server.pid"
LOG_FILE="/tmp/new_dashboard_server.log"

if [[ -f "$PID_FILE" ]]; then
  existing_pid=$(<"$PID_FILE")
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Restarting existing dashboard server..."
    kill "$existing_pid" 2>/dev/null || true
    sleep 1
  fi
fi

rm -f "$PID_FILE"

listening_pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "$listening_pids" ]]; then
  echo "Stopping existing server on port ${PORT}..."
  for pid in ${(f)listening_pids}; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
fi

nohup python3 "$SCRIPT_DIR/dashboard_server.py" --host "$HOST" --port "$PORT" >"$LOG_FILE" 2>&1 &
server_pid=$!
echo "$server_pid" > "$PID_FILE"

for _ in {1..40}; do
  if curl -fsS "http://${HOST}:${PORT}/api/config" >/dev/null 2>&1; then
    echo "Dashboard server running at http://${HOST}:${PORT}"
    exit 0
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

echo "Dashboard server did not start successfully. Check $LOG_FILE."
tail -n 20 "$LOG_FILE" 2>/dev/null || true
exit 1
