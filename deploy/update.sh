#!/bin/zsh
# Updates Pretty Penny to the latest version: pulls the code, installs, builds, migrates the
# database, restarts the service and checks it. Stops at the first problem.
set -eo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
source "$NVM_DIR/nvm.sh"

echo "Getting the latest code…"
git pull --ff-only
nvm install >/dev/null
nvm use >/dev/null

echo "Installing and building…"
npm ci --no-audit --no-fund
npm run build

echo "Updating the database…"
npm run db:migrate

echo "Restarting…"
"$REPO/deploy/install-service.sh"
# The backup job runs the project's Node version too, which may have changed.
if [[ -f "$HOME/Library/LaunchAgents/com.prettypenny.backup.plist" ]]; then
  "$REPO/deploy/install-backups.sh" >/dev/null
fi
sleep 3
"$REPO/deploy/status.sh"
