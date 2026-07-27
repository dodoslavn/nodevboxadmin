'use strict';

const path = require('node:path');

// Central place for small constants used across modules.
// Keep this dependency-free and side-effect-free (no fs/network calls here).

const ROOT_DIR = path.resolve(__dirname, '..');

// Validate PORT early with a clear error rather than a cryptic listen() throw.
function resolvePort() {
  if (!process.env.PORT) return 3000;
  const p = Number(process.env.PORT);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    throw new Error(`Invalid PORT="${process.env.PORT}" (must be an integer 1-65535).`);
  }
  return p;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR: path.join(ROOT_DIR, 'data'),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),

  CONFIG_FILE: path.join(ROOT_DIR, 'data', 'config.json'),
  AUDIT_LOG_FILE: path.join(ROOT_DIR, 'data', 'audit.log'),

  // Defaults to localhost-only, matching the documented deployment (Apache
  // handles TLS + is the sole public entry point - see DEPLOY.md). Override
  // via HOST/PORT env vars if you need to bind elsewhere. If you set HOST to
  // anything other than a loopback address, make sure you actually have a
  // reverse proxy in front of it (or set TRUST_PROXY=false below) - directly
  // exposing this app trusts the X-Forwarded-For header from any client.
  HOST: process.env.HOST || '127.0.0.1',
  PORT: resolvePort(),

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
