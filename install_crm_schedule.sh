#!/bin/zsh
# Installs the weekly CRM ARR change check as a launchd LaunchAgent (Saturdays 6:00 AM local time).
#   ./install_crm_schedule.sh            install (or reinstall) for this checkout
#   ./install_crm_schedule.sh --dry-run  print the plist without installing
# Remove it with ./uninstall_crm_schedule.sh.
set -euo pipefail

SCRIPT_DIR="${0:a:h}"
LABEL="com.tyler.project-dashboard.crm-weekly"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_FILE="/tmp/project_dashboard_crm.log"

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
fi

# launchd starts jobs with a minimal PATH; pin the python3 used today (it has `requests`).
python_bin="$(command -v python3)"
python_dir="${python_bin:h}"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  print -r -- "$value"
}

repo="$(xml_escape "$SCRIPT_DIR")"
path_value="$(xml_escape "${python_dir}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")"

plist_content="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${repo}/refresh_crm.sh</string>
    <string>--weekly</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${repo}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path_value}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>6</integer>
    <key>Hour</key>
    <integer>6</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>"

if [[ "$dry_run" -eq 1 ]]; then
  print -r -- "$plist_content"
  exit 0
fi

mkdir -p "${PLIST:h}"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
print -r -- "$plist_content" > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed ${LABEL}: runs ${SCRIPT_DIR}/refresh_crm.sh --weekly every Saturday at 6:00 AM."
echo "Log: ${LOG_FILE}"
