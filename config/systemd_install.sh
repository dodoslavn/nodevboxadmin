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
# file) so this script is self-contained.
UNIT_CONTENT="[Unit]
Description=nodevboxadmin - VirtualBox web management app
Documentation=file:$REPO_DIR/DEPLOY.md
After=network.target vboxdrv.service
Wants=vboxdrv.service

[Service]
Type=simple

# IMPORTANT: VirtualBox VM config is per-OS-user. The webapp shells out to
# VBoxManage AS ITS OWN USER, so it must run as the user that owns the VMs.
# Running as any other user would see an empty, unrelated VBox config.
User=$APP_USER
Group=$APP_GROUP

WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN $REPO_DIR/server.js
Environment=NODE_ENV=production
# PORT, HOST, TRUST_PROXY, and everything else app-level are NOT set here -
# the app reads them from config/config.json directly, regardless of how
# it's started. Edit that file and restart the service to change them.

Restart=on-failure
RestartSec=5

# --- Sandboxing ---
# These restrict the service. VirtualBox/VBoxManage can be sensitive to
# sandboxing; if VMs fail to start or VBoxManage errors after enabling these,
# relax the offending directive and re-test (see DEPLOY.md troubleshooting).
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
# data/ is the only path the app writes to. VirtualBox also needs to write to
# the VM owner's home (~/.config/VirtualBox, ~/VirtualBox VMs) and /tmp; those
# are covered by ProtectHome=false + PrivateTmp. Add more ReadWritePaths if
# your VM storage lives elsewhere.
ReadWritePaths=$REPO_DIR/data

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
