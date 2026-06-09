#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:a:h}"
if "$SCRIPT_DIR/refresh_go_lives.sh"; then
  echo
  echo "Go-Lives refresh completed."
else
  exit_code=$?
  echo
  echo "Go-Lives refresh failed with exit code ${exit_code}."
fi

echo "Press Return to close this window."
read
