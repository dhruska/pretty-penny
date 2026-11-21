#!/bin/zsh
# Installs Pretty Penny as a macOS background service (a launchd agent) that starts when you log
# in and restarts if it stops. Run it again any time; it replaces and restarts the service.
#
# For testing, LABEL, DATABASE_URL and API_PORT set when running this go into the service too.
set -eo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${LABEL:-com.prettypenny.server}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/PrettyPenny"
DOMAIN="gui/$(id -u)"

if [[ ! -f "$REPO/server/dist/index.js" || ! -f "$REPO/client/dist/index.html" ]]; then
  echo "Build the app first: npm run build" >&2
  exit 1
fi

# The service runs the project's Node version, found through nvm.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
source "$NVM_DIR/nvm.sh"
cd "$REPO"
nvm use >/dev/null
NODE="$(command -v node)"

extra_env=""
for name in DATABASE_URL API_PORT; do
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
    <string>$REPO/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
$extra_env  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$LABEL.log</string>
</dict>
</plist>
PLIST

# Replace any running copy, then start the new one. Stopping finishes after bootout returns, so
# wait for the old copy to be gone, or starting the new one fails.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
for _ in {1..50}; do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.2
done
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Pretty Penny's service ($LABEL) is installed and starting."
echo "It starts whenever you log in. Logs: $LOGS/$LABEL.log"
