#!/bin/zsh
# Refresh client ARR from Dynamics CRM (through the Foundry agent) into dashboard/data/crm/ (local only).
#   ./refresh_crm.sh                 weekly change check (default; re-checks everything on the first weekend)
#   ./refresh_crm.sh --initial       one-time full load
#   ./refresh_crm.sh --new-only      only clients never fetched before
#   ./refresh_crm.sh --force         re-fetch every client
#   ./refresh_crm.sh --weekly-if-overdue
set -euo pipefail

SCRIPT_DIR="${0:a:h}"
cd "$SCRIPT_DIR"

LOG_FILE="/tmp/project_dashboard_crm.log"
mode="${1:---weekly}"
case "$mode" in
  --initial|--weekly|--new-only|--force|--weekly-if-overdue) ;;
  *)
    echo "Usage: $0 [--initial|--weekly|--new-only|--force|--weekly-if-overdue]"
    exit 64
    ;;
esac

if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

print -r -- "" >> "$LOG_FILE"
print -r -- "=== $(date '+%Y-%m-%d %H:%M:%S') refresh_crm.sh ${mode} ===" >> "$LOG_FILE"

set +e
if [[ -t 1 ]]; then
  python3 fetch_crm_arr.py "$mode" 2>&1 | tee -a "$LOG_FILE"
  exit_code=${pipestatus[1]}
else
  python3 fetch_crm_arr.py "$mode" >> "$LOG_FILE" 2>&1
  exit_code=$?
fi
set -e

print -r -- "=== exit ${exit_code} ===" >> "$LOG_FILE"
exit $exit_code
