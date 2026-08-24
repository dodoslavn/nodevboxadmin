# nodevboxadmin — Deployment Guide

Operational runbook for deploying the nodevboxadmin web app on Debian stable.
The app is a dependency-free Node.js service that manages VirtualBox VMs by
shelling out to `VBoxManage`. It runs in place from wherever you cloned it —
there's no copy-to-`/opt` step.

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

### cloud-image-utils (for the Cloud-Init page)
The Cloud-Init ISO builder shells out to `cloud-localds` to build NoCloud
seed ISOs. Not required for the rest of the app.
```bash
sudo apt install cloud-image-utils
cloud-localds --version
```

### The VM-owning OS user
VirtualBox VM configuration is **per-user**. All VMs on this host should be
owned by one dedicated OS user (default assumed throughout this doc:
`virtualbox`). The web app runs as this same user so it sees the right VBox
config.

```bash
id virtualbox                       # confirm the user exists
sudo usermod -aG vboxusers virtualbox
```

### Reverse proxy (optional but recommended)
The app binds to `127.0.0.1` only by default and has no TLS of its own. If
you need HTTPS or access from outside the host, put a reverse proxy
(Apache, nginx, Caddy — whatever you already run) in front of it, pointed at
`127.0.0.1:<PORT>`. An example Apache vhost is at
`config/apache_vhost.example` (copy + edit, not consumed by any script - see
the instructions at the top of that file). See `TRUST_PROXY` in section 5 if
you do this.

---

## 2. Install the app

```bash
cd /path/to/where/you/cloned/nodevboxadmin
cp config/config.json.example config/config.json   # required - app settings live here
sudo ./config/systemd_install.sh              # runs as user "virtualbox" by default
# or: sudo ./config/systemd_install.sh someuser
```

`systemd_install.sh` itself needs no config file (see section 2's argument
above) - but the app won't start without `config/config.json` existing, so
don't skip that copy step. It installs and starts a `nodevboxadmin.service`
systemd unit that runs `node server.js` directly from this checkout
(`WorkingDirectory` = the clone path), as the given OS user (its primary
group is used as the unit's `Group=`). Creates `data/` (0700, owned by
that user) if it doesn't already exist.

### Set the admin password (first run)
```bash
sudo -u virtualbox node config/password-reset.js
```
Run from the repo directory. Interactive; prompts for username + password
(min 8 chars). Writes `data/config.json` (0600, scrypt hash). Re-run any
time to reset.

---

## 3. Verify

```bash
systemctl status nodevboxadmin.service
curl -s http://127.0.0.1:3000/healthz              # {"ok":true,...}
```

- Log in through the browser.
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

## 4. Configuration (config/config.json)

App settings are a static JSON file, not environment variables - edit
`config/config.json` directly and restart the service (`sudo systemctl
restart nodevboxadmin`) to pick up a change. This is the single source of
truth regardless of how the app is started (systemd, `node server.js`
directly, etc.).

(Who the systemd service runs as is set via a command-line argument to
`systemd_install.sh`, not a config file - see section 2.)

| Key | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | `"127.0.0.1"` | Listen address. Only bind to something other than a loopback address if you know what's fronting it - see `TRUST_PROXY` below. |
| `TRUST_PROXY` | `true` | Whether to trust a reverse proxy's `X-Forwarded-For` for rate-limiting. Set to `false` if the app is ever reachable directly (no reverse proxy in front), otherwise a client can spoof its own rate-limit identity. |
| `INSTANCE_NAME` | `""` | Shown in the page title, nav header, and login page instead of the plain app name - set this (e.g. to the hypervisor's hostname or role) if you run more than one instance against different VirtualBox hosts, so browser tabs/bookmarks stay distinguishable. |
| `VBOXMANAGE_BIN` | `"VBoxManage"` | Path to the VBoxManage binary, if not on `PATH`. |
| `CLOUD_LOCALDS_BIN` | `"cloud-localds"` | Path to the `cloud-localds` binary (from `cloud-image-utils`), if not on `PATH`. Used by the Cloud-Init ISO builder. |
| `CLOUD_INIT_DIR` | `"data/cloud-init"` | Where generated cloud-init seed ISOs (for unattended VM installs) are written. Relative paths resolve against the repo root; use an absolute path to store them elsewhere (e.g. a larger disk). |

The rest of `config/config.json` (session TTL, scrypt cost, rate limits,
etc.) is exposed the same way - edit the field, restart the service.

## 5. Operations

| Task | Command |
|---|---|
| Status | `systemctl status nodevboxadmin` |
| Logs | `journalctl -u nodevboxadmin -f` |
| Restart | `sudo systemctl restart nodevboxadmin` |
| Update code | `git pull` in the repo, then `sudo systemctl restart nodevboxadmin` |
| Reset admin password | `sudo -u virtualbox node config/password-reset.js` (from repo dir) |
| Audit log | `sudo cat data/audit.log` (JSONL, from repo dir) |
| Uninstall service | `sudo ./config/systemd_uninstall.sh` (leaves code + data/ untouched) |

Backup: copy the repo's `data/` directory (holds credential, registry, audit log).

---

## 6. Caveats & troubleshooting

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
The generated unit sets `ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`,
etc. VirtualBox can be sensitive to these. If VMs fail to start or VBoxManage
errors only under systemd (but work when run manually), edit
`/etc/systemd/system/nodevboxadmin.service` directly and relax the offending
directive (commonly `ProtectSystem` or add `ReadWritePaths` for your VM
storage location), then `sudo systemctl daemon-reload && sudo systemctl
restart nodevboxadmin`. VM storage defaults to `~virtualbox/VirtualBox VMs`.

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
