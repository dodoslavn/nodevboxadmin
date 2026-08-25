# Node Vbox Admin

Web UI tool to manage VirtualBox VMs on the system. All it does is run "vboxmanage" executable on the background
Runs on NodeJS, with minimum dependencies.  

> **This project is completely vibe-coded** — written by an AI coding agent
> from natural-language instructions, with human review and testing but no
> hand-written code. Read it before you trust it with a production host.

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
- VirtualBox (obviously)
- HTTP Reverse Proxy (recommended)
- Linux (developed against VirtualBox 7.2.x on Ubuntu/Debian)

## Installation
Move to some folder where you will keep the application permanently a.g.:  
> cd /opt/git/  
Clone the Git repo:  
> git clone https://github.com/dodoslavn/nodevboxadmin  
> cd nodevboxadmin
Copy and edit configuration file:  
> cp config/config.json.example config/config.json
> editor config/config.json
Set new username and password:  
> node config/password-reset.js
Test the application if it works:  
> node server.js
Install the application as a SystemD service:
> config/systemd_install.sh
```

Then open `http://127.0.0.1:3000` and log in.

Override the listen address/port (or anything else) by editing
`config/config.json` and restarting. See
[DEPLOY.md](DEPLOY.md#4-configuration-configconfigjson) for the full list of
settings and the security note on `TRUST_PROXY` if you bind to anything
other than a loopback address.

For a real deployment (installed as a systemd service via
`config/systemd_install.sh`, running in place from the clone), see
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
- Meant to run behind a reverse proxy that terminates TLS if exposed beyond
  the host; the app binds to `127.0.0.1` only by default (configurable, see
  above)
- All `VBoxManage` calls use `execFile` with argument arrays — never a shell
  — so user input can't inject shell commands

## License

Apache 2.0 — see [LICENSE](LICENSE).
