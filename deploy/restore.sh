#!/bin/zsh
# Replaces everything in Pretty Penny with a backup. The current data is backed up first, the app
# is stopped while restoring and started again afterward, and every device is signed out.
#
# Usage: deploy/restore.sh /path/to/pretty-penny-2026-11-21-030000.dump
set -eo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${LABEL:-com.prettypenny.server}"
DOMAIN="gui/$(id -u)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
file="$1"

if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: deploy/restore.sh <backup file>" >&2
  exit 1
fi
DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' "$REPO/.env" | cut -d= -f2-)}"
"$PG_BIN/pg_restore" --list "$file" >/dev/null || {
  echo "That file can't be read as a backup. Nothing was changed." >&2
  exit 1
}

echo "This replaces everything in Pretty Penny with the backup in:"
echo "  $file"
echo "Anything changed since that backup is lost, and every device is signed out."
read -r "answer?Type restore to continue: "
if [[ "$answer" != "restore" ]]; then
  echo "Nothing was changed."
  exit 1
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
source "$NVM_DIR/nvm.sh"
cd "$REPO"
nvm use >/dev/null

# Restore from a private copy, so nothing that happens to the backup folders can change it.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$file" "$work/restore.dump"

# The current data is backed up first, unless no backup folders are set yet, as on a new Mac.
if [[ -n "${BACKUP_DIRS:-$(grep -E '^BACKUP_DIRS=' .env 2>/dev/null | cut -d= -f2-)}" ]]; then
  echo "Backing up the current data first…"
  DATABASE_URL="$DATABASE_URL" node server/dist/backup-cli.js backup || {
    echo "Couldn't back up the current data, so nothing was changed." >&2
    exit 1
  }
else
  echo "No backup folders are set (BACKUP_DIRS), so the current data isn't backed up first."
fi

was_running=false
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  was_running=true
  launchctl bootout "$DOMAIN/$LABEL"
fi

echo "Restoring…"
"$PG_BIN/pg_restore" --clean --if-exists --no-owner --single-transaction \
  --dbname="$DATABASE_URL" "$work/restore.dump"

if $was_running; then "$REPO/deploy/install-service.sh" >/dev/null; fi
echo "Restored. Sign in again on each device."
