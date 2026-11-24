#!/bin/zsh
# Runs Pretty Penny against Plaid's Sandbox, with its test banks, on a separate database, so
# test transactions never reach your real data. Listens on this Mac's Tailscale address, so a
# phone on your tailnet can open it too. See "Bank sync" in the README.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [[ ! -f .env.sandbox ]]; then
  echo "Make .env.sandbox first, with PLAID_CLIENT_ID, PLAID_SECRET (the Sandbox one),"
  echo "PLAID_ENV=sandbox and BANK_TOKEN_KEY; see the README's Bank sync section."
  exit 1
fi

# The Plaid settings and key, for the commands below only. Nothing is printed.
set -a
source ./.env.sandbox
set +a

if [[ "$PLAID_ENV" != "sandbox" ]]; then
  echo "PLAID_ENV in .env.sandbox must be sandbox, so real banks are never used here."
  exit 1
fi

export DATABASE_URL="${SANDBOX_DATABASE_URL:-postgres://localhost:5432/pretty_penny_try}"
export API_PORT="${SANDBOX_API_PORT:-3201}"
WEB_PORT="${SANDBOX_WEB_PORT:-5373}"
HOST="${SANDBOX_HOST:-$(tailscale ip -4 2>/dev/null | head -1)}"
if [[ -z "$HOST" ]]; then
  echo "Couldn't find this Mac's Tailscale address, so it's only on this Mac."
  HOST=localhost
fi

# Creates the test database the first time, and keeps its tables up to date.
DB_NAME="${DATABASE_URL##*/}"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
if ! "$PG_BIN/psql" -lqt postgres | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  "$PG_BIN/createdb" "$DB_NAME"
  echo "Created $DB_NAME. Set its password with:"
  echo "  DATABASE_URL=$DATABASE_URL npm run set-password"
fi
npm run db:migrate --silent

echo "Open http://$HOST:$WEB_PORT"
exec npx concurrently -k -n api,web -c blue,green \
  "npm run dev -w server" \
  "npm run dev -w client -- --port $WEB_PORT --strictPort --host $HOST"
