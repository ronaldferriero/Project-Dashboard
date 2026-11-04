#!/bin/zsh
# Removes the weekly CRM ARR LaunchAgent installed by install_crm_schedule.sh. Safe to run more than once.
set -euo pipefail

LABEL="com.tyler.project-dashboard.crm-weekly"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed ${LABEL}."
