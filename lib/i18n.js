'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseCookies } = require('./auth');

// Minimal i18n: cookie -> Accept-Language -> 'en' detection, JSON string
// tables per language, {var} substitution. Same shape as the sibling
// phpopenvpnadmin project's lib (web/includes/lang.php + web/lang/*.php),
// adapted to this app's JSON-over-PHP-array convention (see config/config.json).
//
// Scope for now: shared chrome only (nav labels, footer, login page) - see
// views/layout.js and views/login.js. Page bodies (dashboard, disks, etc.)
// stay English until translated in a follow-up pass; t() falls back to the
// English string for any key a page doesn't have yet, so nothing renders
// blank in the meantime.

const LANG_DIR = path.resolve(__dirname, '..', 'lang');

const LANG_CODES = fs
  .readdirSync(LANG_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

const CACHE = {};
function loadLang(code) {
  if (!CACHE[code]) {
    CACHE[code] = JSON.parse(fs.readFileSync(path.join(LANG_DIR, `${code}.json`), 'utf8'));
  }
  return CACHE[code];
}

const BASE = loadLang('en');

function isValidLang(code) {
  return typeof code === 'string' && LANG_CODES.includes(code);
}

// [{code, name}], name in the language's own script (e.g. "Čeština" for
// cs) - sorted by code so the footer picker order is stable across restarts.
function langList() {
  return LANG_CODES.map((code) => ({ code, name: loadLang(code)['lang.name'] || code.toUpperCase() }));
}

// cookie -> Accept-Language -> 'en'. Same precedence as phpopenvpnadmin's
// _detect_lang() in web/includes/lang.php.
function detectLang(req) {
  const cookieLang = parseCookies(req).lang;
  if (isValidLang(cookieLang)) return cookieLang;

  const accept = req.headers['accept-language'] || '';
  for (const part of accept.split(',')) {
    const code = part.trim().split(';')[0].slice(0, 2).toLowerCase();
    if (isValidLang(code)) return code;
  }
  return 'en';
}

// Not HttpOnly/Secure - not sensitive, and this app is also run over plain
// HTTP in dev (see lib/auth.js's sessionCookie for the contrast: that one
// carries a real credential and sets Secure).
function langCookie(code) {
  return `lang=${code}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function t(lang, key, vars = {}) {
  const strings = isValidLang(lang) ? loadLang(lang) : BASE;
  let str = strings[key] ?? BASE[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(`{${k}}`, v);
  }
  return str;
}

module.exports = { LANG_CODES, isValidLang, langList, detectLang, langCookie, t };
