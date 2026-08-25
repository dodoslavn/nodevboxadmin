# Node Vbox Admin

Web UI tool to manage VirtualBox VMs on the system. All it does is run "vboxmanage" executable on the background.  
Runs on NodeJS, with minimum dependencies.  

> **This project is completely vibe-coded** — written by an AI coding agent
> from natural-language instructions, with human review and testing but no
> hand-written code. Read it before you trust it with a production host.

## Limitation
This tool will only see VMs which are configured in the same OS user.

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
Switch to OS user which have the VMs you want to manage, e.g.:
> su - virtualbox

Move to some folder where you will keep the application permanently e.g.:  
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


## License

Apache 2.0 — see [LICENSE](LICENSE).
