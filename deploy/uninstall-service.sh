#!/bin/zsh
# Stops Pretty Penny's background service and removes it. Your data stays in Postgres.
set -eo pipefail

LABEL="${LABEL:-com.prettypenny.server}"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Pretty Penny's service ($LABEL) is stopped and removed."
