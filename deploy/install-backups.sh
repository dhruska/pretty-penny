#!/bin/zsh
# Installs the nightly backup job, which runs at 3am (or at the next chance, if the Mac was
# asleep). Run it again any time; it replaces the job. Set BACKUP_DIRS in .env first.
#
# For testing, BACKUP_LABEL, DATABASE_URL and BACKUP_DIRS set when running this go into the job.
set -eo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${BACKUP_LABEL:-com.prettypenny.backup}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/PrettyPenny"
DOMAIN="gui/$(id -u)"

if [[ ! -f "$REPO/server/dist/backup-cli.js" ]]; then
  echo "Build the app first: npm run build" >&2
  exit 1
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
source "$NVM_DIR/nvm.sh"
cd "$REPO"
nvm use >/dev/null
NODE="$(command -v node)"

extra_env=""
for name in DATABASE_URL BACKUP_DIRS; do
  if [[ -n "${(P)name}" ]]; then
    extra_env+="    <key>$name</key><string>${(P)name}</string>"$'\n'
  fi
done

mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/server/dist/backup-cli.js</string>
    <string>backup</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
$extra_env  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOGS/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$LABEL.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
for _ in {1..50}; do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.2
done
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Nightly backups ($LABEL) are installed and run at 3am. Log: $LOGS/$LABEL.log"
echo "If a backup folder is on an external drive, give Full Disk Access to this program, in"
echo "System Settings, Privacy & Security, Full Disk Access:"
echo "  $NODE"
