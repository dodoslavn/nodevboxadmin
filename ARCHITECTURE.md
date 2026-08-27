# nodevboxadmin — Architecture & Milestones

## 1. Overview

A website that manages VirtualBox VMs in the background, running under a
dedicated OS user on Debian stable. Priorities, in order:

1. **Stability** — minimize moving parts, dependencies, and version-compat risk
2. **Simplicity** — single admin user, no accounts/roles system needed
3. **Security** — no shell injection, no plaintext secrets, session-based auth

Non-goals for v1: multi-user accounts/roles, live console streaming (VNC/RDP),
VM provisioning/cloning from templates, snapshots, resource reconfiguration.

## 2. Stack Summary

| Layer | Choice | Notes |
|---|---|---|
| OS | Debian stable (currently trixie) | |
| Runtime | Node.js (Debian repo package, v20.19.2 at time of writing) | Built-in `http` module only, **no npm dependencies** |
| Storage | Plain JSON files + JSONL audit log | No DB server, no DB driver dependency |
| Auth | Single admin account, session-based login | `node:crypto` `scrypt` for password hashing, in-memory session store |
| VM control | `VBoxManage` via `child_process.execFile` | Argument arrays only, never shell string interpolation |
| VirtualBox source | **Oracle's official VirtualBox APT repo** | Debian stable does not reliably ship VirtualBox in its own repos (contrib-only, frequently missing/blocked from migrating to stable) |
| Reverse proxy | Bring-your-own (Apache/nginx/Caddy/etc.), optional | Only needed for TLS/off-host access - Node listens on `127.0.0.1` by default either way. An example Apache vhost is provided (`config/apache_vhost.example`) but not required |
| Process supervision | systemd | `Restart=on-failure`, runs as dedicated OS user |
| Templating | Plain JS template literals | No template engine dependency |

## 3. Infra Dependencies & Risks

- **Node.js**: installed from Debian's own repos. Confirmed available (v20.19.2
  in trixie). No `node:sqlite` (needs Node ≥22.5) — not needed since we use
  JSON files.
- **VirtualBox**: Debian's own `virtualbox` package lives in `contrib` (not
  `main`, due to the DKMS kernel module `vboxdrv`) and at time of writing has
  **no version listed for `stable`/`oldstable`** — only `unstable`, blocked
  from migrating due to dependency/RC bugs. This is a recurring, documented
  problem for Debian + VirtualBox, not a one-off.
  - **Decision: install via Oracle's official VirtualBox APT repo** instead of
    Debian's package.
  - **Ongoing risk to track**: this repo is managed outside Debian's own
    update cycle. Kernel updates (from Debian's own `linux-image` package)
    can require a DKMS rebuild of `vboxdrv` — verify `vboxdrv` loads after
    every kernel upgrade (`systemctl status vboxdrv`, `lsmod | grep vbox`).
    Pin to a specific VirtualBox major version rather than tracking latest
    blindly.
- **Dedicated OS user**: must be a member of the `vboxusers` group and own/
  have access to the VM files. The Node process runs as this dedicated user
  via systemd. If a reverse proxy is added in front, it only needs to proxy
  HTTP(S) — it does not need VirtualBox permissions itself.

## 4. Data Model (JSON files)

```
data/
  config.json               # { "username": "...", "passwordHash": "...", "salt": "..." }
  vms.json                  # [ { "id": 1, "vboxUuid": "...", "displayName": "..." }, ... ]
  audit.log                 # JSONL, one line per action:
                             # {"ts":"...","action":"start","vmId":1,"result":"ok"}
  cloud-init-templates.json # [ { "id", "name", "userData", "updatedAt" }, ... ] -
                             # saved cloud-config templates, see lib/cloudinit.js
  cloud-init/                # generated seed ISOs (unattended VM installs) -
                              # location configurable via CLOUD_INIT_DIR in config.json
  vm-templates.json         # [ { "uuid", "note", "markedAt" }, ... ] -
                             # VMs marked as clone sources, see lib/vmtemplates.js
```

Live VM state (running/stopped/etc.) is **never persisted** — always fetched
fresh from `VBoxManage list vms --long` / `showvminfo --machinereadable` on
each request. JSON files only ever hold slow-changing config/registry data
and an append-only log — the safe use case for flat files with a single
low-concurrency user.

`lib/store.js` provides a small in-process write queue around read-modify-
write JSON file operations to avoid clobbering under overlapping requests
from the same browser session.

## 5. Project File Structure

```
nodevboxadmin/
├── config/
│   ├── config.json              # app settings (PORT, HOST, TRUST_PROXY, ...) - static, edit directly, no env vars
│   │                             # required directly (require('../config/config.json')) by whichever files need it;
│   │                             # paths like data/config.json are computed locally at each call site instead of
│   │                             # centralized, since they depend on where this repo was cloned
│   ├── apache_vhost.example      # example reverse-proxy vhost (copy + edit, not consumed by any script)
│   ├── password-reset.js        # one-off CLI: sets/resets admin username+password
│   ├── systemd_install.sh       # install the systemd service in-place (unit content inlined, no config file needed)
│   └── systemd_uninstall.sh     # uninstall it
├── data/                    # gitignored; created at first run if missing
│   ├── config.json
│   ├── vms.json
│   └── audit.log
├── lib/
│   ├── auth.js              # login check, session store, scrypt hashing
│   ├── vbox.js               # VBoxManage wrapper (execFile-based)
│   ├── store.js               # JSON file read/write helper + write queue
│   ├── audit.js                # JSONL append-only logger
│   └── router.js                # tiny manual method+path router
├── views/
│   ├── layout.js             # shared HTML shell + CSS block
│   ├── login.js              # login page markup
│   ├── dashboard.js          # VM list page markup
│   └── vmDetail.js           # VM detail page markup
├── public/
│   └── app.js                # small vanilla JS: polling, button handlers
├── server.js                 # entry point: http.createServer + route wiring
├── package.json               # name/version/start script only, no deps
└── ARCHITECTURE.md
```

### Module responsibilities

- **`server.js`** — creates the HTTP server, parses the request, hands off to
  `lib/router.js`, applies auth middleware, catches uncaught errors per
  request (never let one bad request crash the process).
- **`lib/router.js`** — `route(method, pattern, handler)` registration +
  `handle(req, res)` dispatch. Patterns support simple `:id` params, nothing
  fancier (no wildcards/regex needed for this route count).
- **`lib/auth.js`**
  - `verifyLogin(username, password) -> boolean`
  - `createSession() -> sessionId`
  - `getSession(sessionId) -> {valid, expires} | null`
  - `destroySession(sessionId)`
  - `requireAuth(req, res, next)` — middleware-style guard used by protected
    routes, redirects to `/login` if session missing/expired
- **`lib/vbox.js`**
  - `listVms() -> Promise<Array<{uuid, name, state}>>`
  - `getVmInfo(uuid) -> Promise<object>` (parsed `showvminfo --machinereadable`)
  - `startVm(uuid) -> Promise<{ok, message}>`
  - `stopVm(uuid, mode = 'acpipowerbutton'|'poweroff') -> Promise<{ok, message}>`
  - `screenshot(uuid) -> Promise<Buffer>` (PNG bytes, written to a temp file by
    VBoxManage then read back and cleaned up)
  - Internal: `runVBoxManage(args, timeoutMs) -> Promise<{stdout, stderr}>`,
    the single choke point all the above call through — this is where
    `execFile` + timeout + error normalization lives
  - `getNatRules(uuid) -> Promise<{[nicIndex]: Array<{name, protocol, hostIp, hostPort, guestIp, guestPort}>}>`
    — per-VM NAT port-forwarding rules for `nat`-attached NICs. Does its own
    raw-text walk of `showvminfo --machinereadable` output (tracking the
    most recent `nicN=` line as state) rather than going through
    `getVmInfo`/`parseNics` — confirmed by testing that VBox's own
    `Forwarding(0)=`, `Forwarding(1)=`, ... index resets to 0 per-NIC with
    no NIC number in the key, so two NAT-attached NICs both produce
    `Forwarding(0)=`, which the generic flat parser would collide/overwrite
  - `addNatRule(uuid, nicIndex, {...})` / `deleteNatRule(uuid, nicIndex, name)`
    — via `modifyvm --nat-pfN`
- **`lib/store.js`**
  - `readJson(path) -> Promise<object>`
  - `writeJson(path, data) -> Promise<void>` (queued per-file to serialize
    concurrent writes)
- **`lib/cloudinit.js`** — NoCloud cloud-init seed ISO builder
  - `listTemplates()` / `saveTemplate({id, name, userData})` (upsert) /
    `deleteTemplate(id)` — saved cloud-config templates, via `lib/store.js`
    against `data/cloud-init-templates.json`
  - `buildIso({userData, metaData, networkConfig, isoName}) -> Promise<{ok, path, filename}>`
    — `metaData` is caller-supplied JSON (valid YAML too, which is all
    NoCloud requires); `instance-id` is always overwritten with a fresh
    UUID regardless of what's passed in, so cloud-init reliably treats each
    build as a new instance. `{{HOSTNAME}}` in `userData` is substituted
    from `metaData`'s `local-hostname` - the single source of hostname,
    fixing an earlier version that derived it separately from `isoName`
    and could silently conflict with a `hostname:` already set in
    `userData`. `networkConfig` (optional, raw YAML) is written as a third
    seed file via `cloud-localds -N`. All three get packed into
    `<CLOUD_INIT_DIR>/<isoName>.iso`
  - `listIsos()` / `deleteIso(filename)` — plain filesystem listing/deletion
    under `CLOUD_INIT_DIR` (not `VBoxManage list dvds` — a freshly-built ISO
    isn't known to VirtualBox until attached to a VM at least once)
- **`lib/medialibrary.js`** — ISO / disk image library (two configurable
  folders an admin can drop files into, listed on the Disks page with an
  "Add to VirtualBox" button per file)
  - `listIsoLibrary()` / `listDiskLibrary()` — plain filesystem listing
    (not a live watch) under `ISO_LIBRARY_DIR`/`DISK_LIBRARY_DIR`, same
    ENOENT-tolerant shape as `lib/cloudinit.js`'s `listIsos()`. Returns `[]`
    if the corresponding config key is unset
  - "Add to VirtualBox" reuses the existing `POST /disks/register` route
    (`vbox.registerMedium`, via `showmediuminfo`) rather than a dedicated
    route - same mechanism as the Disks page's "Register an existing disk"
    form, just pre-filled with the library file's path/kind
- **`lib/vmtemplates.js`** — VM Templates (existing VMs marked as clone
  sources - unrelated to `lib/cloudinit.js`'s templates above despite the
  shared name)
  - `listMarked()` / `mark({uuid, note})` (upsert) / `unmark(uuid)` — the
    registry itself, via `lib/store.js` against `data/vm-templates.json`.
    Only the UUID + note are persisted; the VM's name/existence is always
    read live from `vbox.listVms()`
  - `cloneFromTemplate({templateUuid, name}) -> Promise<{ok, uuid, name}>`
    — full clone via `VBoxManage clonevm`. Pre-generates the UUID
    (`crypto.randomUUID()`) and passes `--uuid`, since unlike `createvm`,
    `clonevm`'s stdout has no parseable UUID to read back
- **`lib/audit.js`**
  - `logAction({action, vmId, result}) -> Promise<void>` (appends one JSON
    line to `data/audit.log`)
  - `readRecent(vmId, limit) -> Promise<Array>` (tails the log file, filtered)
- **`config/password-reset.js`** — run manually once at deploy time (`node
  config/password-reset.js`), prompts for username/password on stdin, writes
  `data/config.json` with a fresh scrypt hash + salt. Not exposed over HTTP.

## 6. Routes

| Method | Path | Auth | Request | Response | Behavior |
|---|---|---|---|---|---|
| GET | `/login` | no | — | HTML | Render login form. If already authenticated, redirect to `/dashboard`. |
| POST | `/login` | no | form: `username`, `password` | 302 → `/dashboard` or re-render form with error | Verify against `data/config.json`; on success, issue session cookie. |
| POST | `/logout` | yes | — | 302 → `/login` | Destroy session, clear cookie. |
| GET | `/dashboard` | yes | — | HTML | List all registered VMs; initial render includes current status fetched synchronously; page also starts client-side polling. |
| GET | `/api/vms/status` | yes | — | JSON: `[{id, uuid, name, state}]` | Called every ~5s by dashboard JS. Runs `listVms()`/`getVmInfo` live, no cache. |
| GET | `/vms/:id` | yes | — | HTML | VM detail: current status, action buttons, screenshot `<img>`, last N audit entries for this VM. |
| GET | `/vms/:id/screenshot.png` | yes | — | `image/png` | Calls `screenshot(uuid)` on demand, streams PNG bytes back. Returns a placeholder image + 200 if VM isn't running (screenshot not possible). |
| POST | `/vms/:id/start` | yes | — | 302 → `/vms/:id` or JSON `{ok, message}` if `Accept: application/json` | Resolves DB id → UUID, calls `startVm`, writes audit log entry regardless of outcome. |
| POST | `/vms/:id/stop` | yes | form: `mode` (`acpi`\|`hard`) | 302 → `/vms/:id` or JSON | Same pattern as start; `mode` maps to `acpipowerbutton` or `poweroff` — never passed through raw to VBoxManage, mapped via a fixed whitelist. |
| GET | `/vms` | yes | — | HTML | Registry management: list + form to add a new VM by pasting its VBox UUID + a display name. |
| POST | `/vms` | yes | form: `vboxUuid`, `displayName` | 302 → `/vms` | Validates UUID format, (optionally) confirms it exists via `getVmInfo` before saving, appends to `vms.json`. |
| POST | `/vms/:id/delete` | yes | — | 302 → `/vms` | Removes VM from registry only — **never** deletes the actual VM in VirtualBox. |
| GET | `/public/app.js` | no | — | `application/javascript` | Static asset, served directly by `server.js` (no need for a static file library at this size). |
| GET | `/cloud-init` | yes | — | HTML | Template editor, generated-ISO list, default template. |
| POST | `/cloud-init/templates/save` | yes | form: `id?`, `name`, `userData` | 302 → `/cloud-init` (flash) | Upsert a saved template via `lib/cloudinit.js`. |
| POST | `/cloud-init/templates/:id/delete` | yes | — | 302 → `/cloud-init` (flash) | |
| POST | `/cloud-init/build` | yes | form: `outputName`, `userData`, `metaData`, `networkConfig?` | 302 → `/cloud-init` (flash) | Builds `<CLOUD_INIT_DIR>/<outputName>.iso` via `cloud-localds`. Fails clearly (flash error) if that file already exists, `metaData` isn't valid JSON, `cloud-localds` isn't found, or `userData` has `{{HOSTNAME}}` with no `local-hostname` set. |
| POST | `/cloud-init/isos/:filename/delete` | yes | — | 302 → `/cloud-init` (flash) | |
| POST | `/vm-templates/mark` | yes | form: `uuid`, `note?` | 302 → `/vms/new` (flash) | Marks an existing VM as a template via `lib/vmtemplates.js`. |
| POST | `/vm-templates/:uuid/unmark` | yes | — | 302 → `/vms/new` (flash) | Registry only - never touches the actual VM. |
| POST | `/vm-templates/create` | yes | form: `templateUuid`, `name` | 302 → `/vms/:newUuid` or `/vms/new` (flash) on error | Full clone via `VBoxManage clonevm`. |
| POST | `/vms/:uuid/nic/:n/nat-pf` | yes | form: `name`, `protocol`, `hostIp?`, `hostPort`, `guestIp?`, `guestPort` | 302 → `/vms/:uuid/edit#network` (flash) | Adds a NAT port-forward rule to NIC `:n` (must be `nat`-attached). |
| POST | `/vms/:uuid/nic/:n/nat-pf/:name/delete` | yes | — | 302 → `/vms/:uuid/edit#network` (flash) | |

Notes:
- All mutating routes (`POST`) go through `requireAuth` and should validate
  that the `:id` param resolves to a real entry in `vms.json` before doing
  anything — return 404 otherwise, never let an arbitrary id reach
  `lib/vbox.js`.
- No CSRF token library — since this is single-user with `sameSite=strict`
  cookies, that mitigates most CSRF risk; can add a simple hidden token later
  if this ever becomes multi-user.

## 7. Request Lifecycle (example: POST /vms/:id/start)

1. `server.js` receives request, `lib/router.js` matches pattern, extracts `id`
2. `requireAuth` checks session cookie — if invalid, redirect to `/login`
3. Handler reads `vms.json` via `lib/store.js`, looks up entry by `id`
   - not found → 404 page
4. Handler calls `vbox.startVm(entry.vboxUuid)`
5. Regardless of result, `lib/audit.js` appends `{action:'start', vmId, result}`
6. Respond: redirect to `/vms/:id` (browser form submit) or JSON (fetch call)

## 8. Security Notes

- All `VBoxManage` calls use `execFile` with array args — never `exec`/string
  concatenation — hard requirement to avoid shell injection.
- VM actions only ever operate on UUIDs already present in `vms.json`; request
  params are resolved to a registered UUID before touching VBoxManage.
- `stop` mode is mapped through a fixed whitelist (`acpi` → `acpipowerbutton`,
  `hard` → `poweroff`), never passed through raw.
- Session cookie: `httpOnly`, `sameSite=strict`, `secure` (requires TLS - see
  the reverse proxy note above if the cookie needs to actually work).
- Passwords: `scrypt` hash + random salt in `data/config.json`, never
  plaintext. Set via `config/password-reset.js`, never over HTTP.
- Basic in-memory rate limiting on action endpoints (simple counter per
  session, no dep).
- Node listens on `127.0.0.1` only by default, never exposed directly to the
  network unless `HOST` is explicitly overridden.
- `data/` directory is outside `public/` (the only directory ever served as
  static files), so it's never web-reachable regardless of proxy config.

## 9. Milestones & Steps

### M0 — Infra Prep
- [ ] Add Oracle's VirtualBox APT repo + signing key
- [ ] Install VirtualBox (pin a specific major version)
- [ ] Verify `VBoxManage --version` and `vboxdrv` kernel module loads
      (`systemctl status vboxdrv`, `lsmod | grep vbox`)
- [ ] Create dedicated OS user, add to `vboxusers` group
- [ ] Verify `VBoxManage list vms` works as that user
- [ ] Confirm Node.js installed from Debian repos (`node -v`)

### M1 — Project Skeleton
- [ ] Init project structure (`server.js`, `lib/`, `views/`, `public/`, `data/`)
- [ ] `lib/router.js` minimal router, one test route ("hello world")
- [ ] Draft systemd unit (`config/systemd_install.sh`, in-place - no reverse
      proxy bundled, bring your own if exposing beyond localhost)
- [ ] Deploy this skeleton end-to-end first (systemd service running) before
      writing any real app logic

### M2 — Auth
- [ ] `config/password-reset.js` bootstrap script (set initial admin username/password)
- [ ] `lib/auth.js`: `verifyLogin`, session issue/verify, `scrypt` hashing
- [ ] `GET/POST /login`, `POST /logout`
- [ ] `requireAuth` middleware applied to all protected routes

### M3 — VM Registry
- [ ] `GET/POST /vms`, `POST /vms/:id/delete`
- [ ] `vms.json` CRUD via `lib/store.js`

### M4 — VBoxManage Wrapper
- [ ] `lib/vbox.js`: `listVms`, `getVmInfo`, `startVm`, `stopVm`, `screenshot`
- [ ] Manual CLI test script (no HTTP yet) to validate wrapper behavior and
      error handling (VM not found, VBox not running, timeout)

### M5 — Dashboard
- [ ] `GET /api/vms/status` JSON endpoint
- [ ] `GET /dashboard` page listing VMs with live status
- [ ] `public/app.js`: vanilla JS polling (`fetch` + `setInterval`, ~5s)

### M6 — Actions
- [ ] `POST /vms/:id/start`, `POST /vms/:id/stop` wired to `lib/vbox.js`
- [ ] `lib/audit.js` entry written for every action (success or failure)
- [ ] Confirmation prompt for stop action in UI

### M7 — VM Detail + Screenshot
- [ ] `GET /vms/:id` page (status, recent audit entries for that VM)
- [ ] `GET /vms/:id/screenshot.png` on-demand capture, refreshed on same poll
      interval

### M8 — Hardening
- [ ] Error handling for all VBoxManage failure modes
- [ ] Rate limiting on action endpoints
- [ ] Review session cookie flags, password hashing params
- [ ] Review file permissions on `data/` (not web-readable)

### M9 — Deployment
- [ ] Finalize systemd unit (`Restart=on-failure`, correct `User=`)
- [ ] Verify restart-on-crash and restart-on-reboot behavior
- [ ] Document the Oracle VirtualBox repo pin + DKMS-after-kernel-update
      check as an operational runbook item

## 10. Open Items

None outstanding — all major decisions resolved:
- Language/runtime: Node.js, built-in modules only
- Storage: JSON files
- Auth: single admin, session-based
- VirtualBox source: Oracle's official APT repo
- Reverse proxy: bring-your-own if needed; example Apache vhost provided
- Process supervision: systemd
