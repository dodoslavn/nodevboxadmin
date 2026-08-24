#!/usr/bin/env bash
# Uninstall the nodevboxadmin systemd service installed by
# systemd_install.sh. Stops and disables the unit and removes it from
# /etc/systemd/system. Does NOT touch the app code or data/ - the repo at
# its clone location is left exactly as-is.
#
# Usage:
#   sudo ./config/systemd_uninstall.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_NAME="nodevboxadmin.service"
UNIT_DST="/etc/systemd/system/$UNIT_NAME"

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root: sudo $0" >&2
  exit 1
fi

systemctl stop "$UNIT_NAME" 2>/dev/null || true
systemctl disable "$UNIT_NAME" 2>/dev/null || true
rm -f "$UNIT_DST"
systemctl daemon-reload

echo "Removed $UNIT_NAME. App code and data/ under $REPO_DIR are untouched."
