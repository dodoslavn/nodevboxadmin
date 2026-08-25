#!/usr/bin/env bash
# Install the nodevboxadmin systemd service, running the app directly from
# wherever this repo was cloned - no copy to /opt, no separate deploy user
# staging step, no config file needed. Just creates and starts the unit.
#
# Usage:
#   sudo ./config/systemd_install.sh [app-user]
#
# app-user (default: virtualbox) is the OS user the service runs as, and
# must own/have access to the VirtualBox VMs (VBox config is per-OS-user)
# and be a member of the vboxusers group. Its primary group is used as-is.
#
# App settings (PORT, HOST, TRUST_PROXY, ...) are NOT handled here - the app
# reads those from config/config.json directly. Edit that file and restart
# the service to change them.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_NAME="nodevboxadmin.service"
UNIT_DST="/etc/systemd/system/$UNIT_NAME"

APP_USER="${1:-virtualbox}"

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (writes /etc/systemd/system): sudo $0" >&2
  exit 1
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "ERROR: user '$APP_USER' does not exist. Create it (and add to vboxusers) first." >&2
  exit 1
fi
APP_GROUP="$(id -gn "$APP_USER")"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found on PATH." >&2
  exit 1
fi

# The unit file content, kept inline here (rather than a separate template
# file) so this script is self-contained. Deliberately minimal - no
# sandboxing directives, no WorkingDirectory (ExecStart already uses an
# absolute path, and the app resolves its own paths via __dirname, not cwd),
# no Environment= (app settings come from config/config.json, not env vars).
# Matches the plain, known-working unit shape already run in production.
UNIT_CONTENT="[Unit]
Description=nodevboxadmin - VirtualBox web management app
After=network.target vboxdrv.service
Wants=vboxdrv.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
ExecStart=$NODE_BIN $REPO_DIR/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
"

printf '%s\n' "$UNIT_CONTENT" > "$UNIT_DST"

mkdir -p "$REPO_DIR/data"
chmod 0700 "$REPO_DIR/data"
chown -R "$APP_USER":"$APP_GROUP" "$REPO_DIR/data"

systemctl daemon-reload
systemctl enable "$UNIT_NAME"
systemctl restart "$UNIT_NAME"

echo "Installed and started $UNIT_NAME, running $REPO_DIR/server.js as $APP_USER."
echo "Check with: systemctl status $UNIT_NAME"
