'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Central place for small constants used across modules.
// Kept side-effect-free (no network calls, nothing that can block or fail
// unpredictably) with one deliberate exception: a best-effort synchronous
// read of data/config.json below, so INSTANCE_NAME can be set persistently
// (via bin/set-instance-name.js) instead of only through an env var.

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'data', 'config.json');

// Validate PORT early with a clear error rather than a cryptic listen() throw.
function resolvePort() {
  if (!process.env.PORT) return 3000;
  const p = Number(process.env.PORT);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    throw new Error(`Invalid PORT="${process.env.PORT}" (must be an integer 1-65535).`);
  }
  return p;
}

// Reads the persisted instanceName out of data/config.json, if the file
// exists and has one set. Synchronous (this only runs once, at startup) and
// deliberately tolerant of a missing/corrupt/pre-setup-admin file - falls
// back to '' rather than crashing the app over a cosmetic setting.
function readPersistedInstanceName() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const data = JSON.parse(raw);
    return typeof data.instanceName === 'string' ? data.instanceName : '';
  } catch {
    return '';
  }
}

module.exports = {
  ROOT_DIR,
  DATA_DIR: path.join(ROOT_DIR, 'data'),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),

  CONFIG_FILE,
  AUDIT_LOG_FILE: path.join(ROOT_DIR, 'data', 'audit.log'),

  // Defaults to localhost-only, matching the documented deployment (Apache
  // handles TLS + is the sole public entry point - see DEPLOY.md). Override
  // via HOST/PORT env vars if you need to bind elsewhere. If you set HOST to
  // anything other than a loopback address, make sure you actually have a
  // reverse proxy in front of it (or set TRUST_PROXY=false below) - directly
  // exposing this app trusts the X-Forwarded-For header from any client.
  HOST: process.env.HOST || '127.0.0.1',
  PORT: resolvePort(),

  // Shown in the page title and nav header instead of the plain app name -
  // set this per instance (e.g. the hypervisor's hostname or role) so
  // browser tabs/bookmarks stay distinguishable when you run more than one
  // of these against different VirtualBox hosts. Falls back to
  // "nodevboxadmin" if unset (see views/layout.js). The INSTANCE_NAME env var
  // wins if set; otherwise falls back to whatever's persisted in
  // data/config.json (set via `node bin/set-instance-name.js <name>`), so it
  // survives without needing an env var/systemd edit. Read once at startup,
  // like the other settings here - restart to pick up a change either way.
  INSTANCE_NAME: process.env.INSTANCE_NAME || readPersistedInstanceName(),

  SESSION_COOKIE_NAME: 'vbm_session',
  SESSION_TTL_MS: 12 * 60 * 60 * 1000, // 12 hours

  VBOXMANAGE_BIN: process.env.VBOXMANAGE_BIN || 'VBoxManage',
  VBOXMANAGE_TIMEOUT_MS: 15000,
  SCREENSHOT_TIMEOUT_MS: 20000,

  // Confirmed by testing: VBoxSVC can intermittently fail to spawn this
  // exact setuid helper itself (a genuine upstream race - VBoxSVC.log shows
  // "NetIfAdpCtl: failed to create process ... iStats=38"), while invoking
  // it directly, bypassing VBoxSVC, works reliably. Used as a fallback for
  // host-only interface static IP config - see configureHostOnlyInterfaceIp
  // in lib/vbox.js.
  VBOXNETADPCTL_BIN: process.env.VBOXNETADPCTL_BIN || '/usr/lib/virtualbox/VBoxNetAdpCtl',

  // Password hashing (scrypt) cost parameters. Pinned explicitly rather than
  // relying on Node defaults so they're auditable and stable across versions.
  // N=16384 (2^14) is Node's default and a reasonable interactive-login cost.
  SCRYPT_PARAMS: { N: 16384, r: 8, p: 1 },
  SCRYPT_KEYLEN: 64,

  // Rate limiting (fixed-window, in-memory).
  LOGIN_RATE: { windowMs: 15 * 60 * 1000, max: 10 }, // 10 attempts / 15 min per IP
  ACTION_RATE: { windowMs: 60 * 1000, max: 30 }, // 30 start/stop / min per IP
  // Screenshots spawn a VBoxManage subprocess each; detail.js polls ~every 5s
  // (~12/min per open tab). Allow a few tabs before limiting.
  SCREENSHOT_RATE: { windowMs: 60 * 1000, max: 60 }, // 60 screenshots / min per IP

  // Trust a reverse proxy's X-Forwarded-For for the client IP. Since this app
  // is designed to run ONLY behind Apache on localhost, this is safe. If ever
  // exposed directly, set to false so a client can't spoof its IP.
  TRUST_PROXY: process.env.TRUST_PROXY !== 'false',
};
