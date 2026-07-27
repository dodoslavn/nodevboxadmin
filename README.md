# nodevboxadmin

A small, dependency-free Node.js web admin panel for managing VirtualBox on
a single Linux host. Runs as a plain `http` server (no Express, no npm
dependencies at all) and drives everything through `VBoxManage`.

## Features

- **Dashboard** — every registered VM, live status, start/stop, polling auto-refresh
- **Full VM settings editor** — General, System, Display, Audio, Network, Serial
  Ports, USB, Shared Folders, and Storage tabs, matching the real VirtualBox
  GUI's settings dialog
- **Storage** — add/remove controllers, attach/detach/create disks (VDI, VMDK,
  VHD, QCOW), permanently delete disk files from the host
- **Virtual media** — a host-wide inventory of every disk/ISO/floppy
  VirtualBox knows about, including orphaned media left behind after a
  detach-only, with cleanup and detach actions
- **Networks** — NAT Networks and host-only interfaces (create/remove/
  configure IP/DHCP), plus read-only bridged interface and internal network
  info
- **Host status** — uptime, OS/kernel/VirtualBox version, and whether
  VirtualBox's kernel modules are actually loaded
- **Audit log** — every action recorded to an append-only JSONL log
- Single-admin session auth (scrypt-hashed password), rate limiting on
  login/actions, CSRF-resistant cookies

## Requirements

- Node.js >= 20
- VirtualBox installed and `VBoxManage` on `PATH`
- Linux (developed against VirtualBox 7.2.x on Ubuntu/Debian)

## Quick start

```bash
git clone https://github.com/dodoslavn/nodevboxadmin
cd nodevboxadmin
node bin/setup-admin.js   # sets the admin username/password
node server.js            # listens on 127.0.0.1:3000 by default
```

Then open `http://127.0.0.1:3000` and log in.

For a real deployment (systemd service + Apache reverse proxy with TLS), see
[DEPLOY.md](DEPLOY.md). For the design rationale and internal architecture,
see [ARCHITECTURE.md](ARCHITECTURE.md).

## Why no dependencies?

Fewer moving parts, less version-compat risk, no supply-chain surface to
worry about for a small single-admin tool that only needs to render HTML
forms and shell out to `VBoxManage`. See `ARCHITECTURE.md` for the full
reasoning.

## Security notes

- Single admin user, no roles/accounts system — this is a personal/small-team
  admin tool, not multi-tenant
- Meant to run behind a reverse proxy (Apache) that terminates TLS; the app
  itself binds to `127.0.0.1` only
- All `VBoxManage` calls use `execFile` with argument arrays — never a shell
  — so user input can't inject shell commands

## License

Apache 2.0 — see [LICENSE](LICENSE).
