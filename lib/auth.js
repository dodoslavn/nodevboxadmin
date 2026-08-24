'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const config = require('../config/config.json');
const store = require('./store');

// data/config.json is computed here rather than centralized, since it
// depends on where this repo was cloned (no JSON equivalent of __dirname).
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

// Authentication + session handling. Single admin user. No external deps.
//
// Password hashing: scrypt (built into node:crypto) with a random per-user
// salt. Stored format in data/config.json:
//   { "username": "...", "salt": "<hex>", "passwordHash": "<hex>" }
//
// Sessions: opaque random token stored in an in-memory Map. This means all
// sessions are dropped on restart (acceptable: single admin just logs in
// again). No session data is persisted to disk.

const SCRYPT_KEYLEN = config.SCRYPT_KEYLEN;

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  // scryptSync needs a maxmem large enough for the chosen N,r,p.
  const { N, r, p } = config.SCRYPT_PARAMS;
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });
  return derived.toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// Build the object to persist for a new/updated admin credential.
function buildCredential(username, password) {
  const salt = makeSalt();
  return {
    username,
    salt,
    passwordHash: hashPassword(password, salt),
  };
}

// Constant-time comparison to avoid timing attacks on the hash.
function safeEqualHex(aHex, bHex) {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function verifyLogin(username, password) {
  const cred = await store.readJson(CONFIG_FILE, null);
  if (!cred || !cred.username || !cred.salt || !cred.passwordHash) return false;
  if (username !== cred.username) {
    // Still compute a hash to keep timing roughly constant even on bad username.
    hashPassword(password, cred.salt);
    return false;
  }
  const candidate = hashPassword(password, cred.salt);
  return safeEqualHex(candidate, cred.passwordHash);
}

// --- Sessions ---

const sessions = new Map(); // sessionId -> { expires: number }

function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { expires: Date.now() + config.SESSION_TTL_MS });
  return id;
}

function getSession(id) {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(id);
    return null;
  }
  return s;
}

function destroySession(id) {
  if (id) sessions.delete(id);
}

// Periodically evict expired sessions so the Map can't grow unbounded.
function startSessionSweeper() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now > s.expires) sessions.delete(id);
    }
  }, 60 * 1000);
  timer.unref();
  return timer;
}

// --- Cookie helpers ---

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function sessionCookie(id, { clear = false } = {}) {
  const attrs = [
    `${config.SESSION_COOKIE_NAME}=${clear ? '' : id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Secure',
  ];
  if (clear) {
    attrs.push('Max-Age=0');
  } else {
    attrs.push(`Max-Age=${Math.floor(config.SESSION_TTL_MS / 1000)}`);
  }
  return attrs.join('; ');
}

// Returns the valid session for this request, or null.
function sessionForRequest(req) {
  const cookies = parseCookies(req);
  const id = cookies[config.SESSION_COOKIE_NAME];
  const s = getSession(id);
  return s ? { id, session: s } : null;
}

// Guard for protected routes. Returns true if authenticated; otherwise sends
// a redirect (browser) or 401 (JSON/fetch) and returns false.
function requireAuth(req, res) {
  if (sessionForRequest(req)) return true;

  const accept = req.headers.accept || '';
  if (accept.includes('application/json')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  } else {
    res.writeHead(302, { Location: '/login' });
    res.end();
  }
  return false;
}

// Returns the configured admin username (for display in nav), or ''.
async function currentUsername() {
  const cred = await store.readJson(CONFIG_FILE, null);
  return cred && cred.username ? cred.username : '';
}

module.exports = {
  hashPassword,
  buildCredential,
  verifyLogin,
  createSession,
  getSession,
  destroySession,
  startSessionSweeper,
  parseCookies,
  sessionCookie,
  sessionForRequest,
  requireAuth,
  currentUsername,
};
