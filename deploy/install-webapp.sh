#!/bin/bash
# install-webapp.sh - deploy the nodevboxadmin web app.
# Idempotent-ish: safe to re-run to update code. Does NOT overwrite existing
# admin credentials (data/config.json) or the registry (data/vms.json).
#
# Run as root (needs to write /opt and install a systemd unit):
#   sudo ./install-webapp.sh
#
# Prerequisites (see DEPLOY.md):
#   - Node.js installed (node -v)
#   - VirtualBox installed, VBoxManage on PATH, vboxdrv loaded
#   - The VM-owning OS user exists (default: "virtualbox") and is in vboxusers
#   - Apache with proxy/proxy_http/ssl/headers modules enabled
set -euo pipefail

APP_USER="${APP_USER:-virtualbox}"
INSTALL_DIR="${INSTALL_DIR:-/opt/nodevboxadmin}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing nodevboxadmin from $SRC_DIR to $INSTALL_DIR (user: $APP_USER)"

if ! id "$APP_USER" >/dev/null 2>&1; then
    echo "ERROR: user '$APP_USER' does not exist. Create it (and add to vboxusers) first."
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node not found on PATH. Install Node.js first (see DEPLOY.md)."
    exit 1
fi

if ! command -v VBoxManage >/dev/null 2>&1; then
    echo "WARNING: VBoxManage not found on PATH. The app will run but cannot manage VMs."
fi

# Copy application code (exclude runtime data + VCS).
mkdir -p "$INSTALL_DIR"
for item in bin lib views public server.js package.json; do
    cp -r "$SRC_DIR/$item" "$INSTALL_DIR/"
done

# Deploy files reference (kept for operators).
mkdir -p "$INSTALL_DIR/deploy"
cp "$SRC_DIR/deploy/"* "$INSTALL_DIR/deploy/" 2>/dev/null || true
[ -f "$SRC_DIR/DEPLOY.md" ] && cp "$SRC_DIR/DEPLOY.md" "$INSTALL_DIR/" || true

# Ensure data dir exists with tight perms, owned by the app user.
mkdir -p "$INSTALL_DIR/data"
chmod 0700 "$INSTALL_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$INSTALL_DIR"

# Install systemd unit (substituting user/dir if customized).
UNIT_SRC="$SRC_DIR/deploy/nodevboxadmin.service"
UNIT_DST="/etc/systemd/system/nodevboxadmin.service"
sed -e "s#/opt/nodevboxadmin#$INSTALL_DIR#g" \
    -e "s#^User=virtualbox#User=$APP_USER#" \
    -e "s#^Group=virtualbox#Group=$APP_USER#" \
    "$UNIT_SRC" > "$UNIT_DST"

systemctl daemon-reload

# First-run: prompt to set the admin password if no config exists.
if [ ! -f "$INSTALL_DIR/data/config.json" ]; then
    echo ""
    echo "No admin credential found. Set one now with:"
    echo "  sudo -u $APP_USER node $INSTALL_DIR/bin/setup-admin.js"
    echo ""
fi

echo "Enabling + starting service..."
systemctl enable nodevboxadmin.service
systemctl restart nodevboxadmin.service

echo ""
echo "Done. Verify with:"
echo "  systemctl status nodevboxadmin.service"
echo "  curl -s http://127.0.0.1:3000/healthz"
echo ""
echo "Next: configure Apache (deploy/apache-vhost.conf) for TLS + proxy."
echo "See DEPLOY.md for the full checklist."
