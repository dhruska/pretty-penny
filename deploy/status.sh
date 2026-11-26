#!/bin/zsh
# Checks that Postgres, Pretty Penny's service and Tailscale's HTTPS address are all working.
set -o pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${LABEL:-com.prettypenny.server}"
LOG="$HOME/Library/Logs/PrettyPenny/$LABEL.log"
PORT="${API_PORT:-$(grep -E '^API_PORT=' "$REPO/.env" 2>/dev/null | cut -d= -f2)}"
PORT="${PORT:-3001}"  # The app's own default when .env sets none.
problems=0

check() {
  if eval "$2" >/dev/null 2>&1; then
    echo "OK    $1"
  else
    echo "FAIL  $1"
    problems=$((problems + 1))
  fi
}

check "Postgres is running" "/opt/homebrew/opt/postgresql@17/bin/pg_isready -q"
check "The service is loaded" "launchctl print gui/$(id -u)/$LABEL"
check "Pretty Penny answers on port $PORT" "curl -fsS http://127.0.0.1:$PORT/api/hello"

# Tailscale's command line tool, from Homebrew or inside the app.
TAILSCALE="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"
if [[ -x "$TAILSCALE" ]]; then
  # The JSON lists both a Tailscale Service and plain serving from the Mac's own name.
  check "Tailscale is serving port $PORT over HTTPS" "$TAILSCALE serve status --json | grep -q 127.0.0.1:$PORT"
else
  echo "SKIP  Tailscale's command line tool wasn't found"
fi

[[ -f "$LOG" ]] && echo "      Log: $LOG ($(du -h "$LOG" | cut -f1))"

# Backups: each folder's newest backup, failing if one is missing or more than 36 hours old.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -f "$REPO/server/dist/backup-cli.js" && -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh"
  (cd "$REPO" && nvm use >/dev/null && node server/dist/backup-cli.js status) || problems=$((problems + 1))
fi

if (( problems > 0 )); then
  echo "$problems problem(s). See docs/self-hosting.md, Troubleshooting."
  exit 1
fi
echo "Everything is running."
