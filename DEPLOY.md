# nodevboxadmin — Deployment Guide

Operational runbook for deploying the nodevboxadmin web app on Debian stable.
The app is a dependency-free Node.js service that manages VirtualBox VMs by
shelling out to `VBoxManage`, fronted by Apache for TLS.

See `ARCHITECTURE.md` for the design rationale.

---

## 1. Prerequisites

### Node.js
Install from Debian repos:
```bash
sudo apt install nodejs
node -v        # must be >= 20
```

### VirtualBox (via Oracle's APT repo)
Debian stable does not reliably ship VirtualBox in its own repos, so install
from Oracle's official APT repo. **This is managed outside Debian's update
cycle — see the DKMS caveat in section 6.**

```bash
# Add Oracle's key + repo (verify current instructions at virtualbox.org)
wget -O- https://www.virtualbox.org/download/oracle_vbox_2016.asc \
  | sudo gpg --dearmor -o /usr/share/keyrings/oracle-vbox.gpg
echo "deb [signed-by=/usr/share/keyrings/oracle-vbox.gpg] \
  https://download.virtualbox.org/virtualbox/debian $(lsb_release -cs) contrib" \
  | sudo tee /etc/apt/sources.list.d/virtualbox.list
sudo apt update
sudo apt install virtualbox-7.2     # pin a specific major version
```

Verify:
```bash
VBoxManage --version
systemctl status vboxdrv           # kernel module must be loaded
lsmod | grep vbox
```

### The VM-owning OS user
VirtualBox VM configuration is **per-user**. All VMs on this host are owned by
the `virtualbox` user (see `../docs/manual.md`). The web app runs as this same
user so it sees the right VBox config.

```bash
id virtualbox                       # confirm the user exists
sudo usermod -aG vboxusers virtualbox
```

> If you use a different owner, set `APP_USER=<user>` when running the
> installer and update the systemd unit's `User=`/`Group=`.

### Apache
```bash
sudo apt install apache2
sudo a2enmod proxy proxy_http ssl headers
sudo systemctl restart apache2
```

---

## 2. Install the app

```bash
cd /path/to/repo/webapp
sudo ./deploy/install-webapp.sh
```

This copies the app to `/opt/nodevboxadmin`, creates `data/` (0700, owned by the
app user), installs+enables the systemd unit, and starts the service.

### Set the admin password (first run)
```bash
sudo -u virtualbox node /opt/nodevboxadmin/bin/setup-admin.js
```
Interactive; prompts for username + password (min 8 chars). Writes
`data/config.json` (0600, scrypt hash). Re-run any time to reset.

---

## 3. Configure Apache (TLS + proxy)

1. Put a TLS cert/key at the paths in `deploy/apache-vhost.conf`
   (`/etc/ssl/certs/nodevboxadmin.crt`, `/etc/ssl/private/nodevboxadmin.key`).
   Use your internal CA or Let's Encrypt.
2. Copy and edit the vhost:
   ```bash
   sudo cp /opt/nodevboxadmin/deploy/apache-vhost.conf \
     /etc/apache2/sites-available/nodevboxadmin.conf
   sudoedit /etc/apache2/sites-available/nodevboxadmin.conf   # set ServerName
   sudo a2ensite nodevboxadmin
   sudo apache2ctl configtest && sudo systemctl reload apache2
   ```

The app trusts `X-Forwarded-For` (set automatically by `mod_proxy_http`) for
per-client rate limiting. Node listens on `127.0.0.1:3000` only — never expose
it directly.

---

## 4. Verify

```bash
systemctl status nodevboxadmin.service
curl -s http://127.0.0.1:3000/healthz              # {"ok":true,...}
curl -skI https://nodevboxadmin.example.internal/   # 200/302 via Apache
```

- Log in through the browser (HTTPS — the session cookie is `Secure`, so it
  will NOT work over plain HTTP).
- Register a VM: get its UUID with `sudo -u virtualbox VBoxManage list vms`,
  paste into the VMs page.
- Confirm start/stop works and appears in the VM's activity log.

### Restart-on-crash / reboot
```bash
# crash recovery (Restart=on-failure):
sudo systemctl kill -s SIGKILL nodevboxadmin
sleep 6 && systemctl status nodevboxadmin   # should be active again

# survives reboot (enabled unit):
sudo reboot     # then re-check status + healthz
```

---

## 5. Configuration (environment variables)

Set these in the systemd unit's `Environment=` lines (see
`deploy/nodevboxadmin.service`) or export them before running `node
server.js` directly.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Must be 1-65535. |
| `HOST` | `127.0.0.1` | Listen address. Only bind to something other than a loopback address if you know what's fronting it - see `TRUST_PROXY` below. |
| `TRUST_PROXY` | `true` | Whether to trust the reverse proxy's `X-Forwarded-For` for rate-limiting. Set to `false` if the app is ever reachable directly (no Apache in front), otherwise a client can spoof its own rate-limit identity. |
| `VBOXMANAGE_BIN` | `VBoxManage` | Path to the VBoxManage binary, if not on `PATH`. |

After changing `HOST`/`PORT`, restart the service (or the process) for it to
take effect - the app reads them once at startup.

## 6. Operations

| Task | Command |
|---|---|
| Status | `systemctl status nodevboxadmin` |
| Logs | `journalctl -u nodevboxadmin -f` |
| Restart | `sudo systemctl restart nodevboxadmin` |
| Update code | re-run `sudo ./deploy/install-webapp.sh` |
| Reset admin password | `sudo -u virtualbox node /opt/nodevboxadmin/bin/setup-admin.js` |
| Audit log | `sudo cat /opt/nodevboxadmin/data/audit.log` (JSONL) |

Backup: copy `/opt/nodevboxadmin/data/` (holds credential, registry, audit log).

---

## 7. Caveats & troubleshooting

### DKMS / kernel updates (IMPORTANT)
VirtualBox's `vboxdrv` kernel module is built via DKMS. A Debian kernel update
can require it to rebuild. **After every kernel upgrade**, verify:
```bash
systemctl status vboxdrv
lsmod | grep vbox
```
If missing: `sudo /sbin/vboxconfig` (or reinstall the vbox package), then
restart `nodevboxadmin`. Pin the VirtualBox major version rather than tracking
latest blindly. This is the single most likely thing to break the deployment
over time.

### "No VMs" / empty list
Almost always the service is running as the wrong user. VBox config is
per-user; the service **must** run as the user that owns the VMs (`virtualbox`
by default). Check `User=` in the unit and `sudo -u virtualbox VBoxManage list vms`.

### VMs won't start after enabling systemd sandboxing
The unit sets `ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`, etc.
VirtualBox can be sensitive to these. If VMs fail to start or VBoxManage errors
only under systemd (but work when run manually), relax the offending directive
(commonly `ProtectSystem` or add `ReadWritePaths` for your VM storage location)
and re-test. VM storage defaults to `~virtualbox/VirtualBox VMs`.

### Screenshot returns 409/503
409 = VM not running (expected). 503 = VBoxManage not found on the service's
PATH. 504 = VBoxManage timed out.

### Session drops on restart
Sessions are in-memory by design; a service restart logs the admin out. Just
log in again.

### Relationship to custom-vboxctl
This web app is independent of the repo's `custom-vboxctl` CLI tooling. Both
manage the same VMs (as the `virtualbox` user) but don't share state. The web
app's start/stop are fire-and-forget; `custom-vboxctl stop` waits for ACPI
shutdown. Don't be surprised if a VM shows "stopped" in the UI only after the
next status poll.
