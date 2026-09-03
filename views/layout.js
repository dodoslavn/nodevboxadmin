'use strict';

const config = require('../config/config.json');
const i18n = require('../lib/i18n');

// Shared HTML shell + minimal CSS. Plain template literals, no engine.
// All dynamic values passed in here must already be escaped by the caller
// via escapeHtml() where they originate from user/VM data.

// The tool's own display name - always shown (in the nav brand, every page's
// <title>, and the login page) so it's clear what tool this is regardless of
// whether an instance name is set.
const PRODUCT_NAME = 'NodeVboxAdmin';

// PRODUCT_NAME, plus config.INSTANCE_NAME appended if set (see
// config/config.json) - so multiple instances against different VirtualBox
// hosts stay distinguishable in browser tabs/bookmarks, without losing which
// tool it actually is.
const BRAND_NAME = config.INSTANCE_NAME ? `${PRODUCT_NAME} — ${config.INSTANCE_NAME}` : PRODUCT_NAME;
const REPO_URL = 'https://github.com/dodoslavn/nodevboxadmin';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    margin: 0; background: #f4f5f7; color: #1a1a1a;
    min-height: 100vh; display: flex; flex-direction: column;
  }
  header {
    background: #23272e; color: #fff; padding: 0.8rem 1.2rem;
    display: flex; align-items: center; justify-content: space-between;
  }
  header a { color: #9ecbff; text-decoration: none; }
  header .brand { font-weight: 600; color: #fff; }
  main { flex: 1; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
  main.login-wrap {
    max-width: none; margin: 0; padding: 2rem 1rem;
    display: flex; align-items: center; justify-content: center;
  }
  .login-outer { display: flex; flex-direction: column; align-items: center; gap: 1.25rem; width: 100%; max-width: 380px; }
  .login-header { display: flex; align-items: center; gap: 0.75rem; }
  .login-app-name { font-size: 26px; font-weight: 700; color: #1a1a1a; }
  .login-box {
    background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
    padding: 2rem; width: 100%; box-shadow: 0 1px 4px rgba(0,0,0,.08);
    display: flex; flex-direction: column; gap: 1rem;
  }
  .login-box h1 { font-size: 16px; color: #6b7280; font-weight: 500; margin: 0; }
  .login-box form { display: flex; flex-direction: column; gap: 0.75rem; }
  .login-box form label { display: flex; flex-direction: column; gap: 0.3rem; margin: 0; font-weight: 500; }
  .login-box form button { width: 100%; margin-top: 0.5rem; }
  footer {
    max-width: 900px; margin: 0 auto 2rem; padding: 0 1rem;
    text-align: center; font-size: 0.85rem; color: #6b7280;
  }
  footer a { color: inherit; }
  .footer-langs { margin-top: 0.4rem; }
  .footer-langs a { margin: 0 0.15rem; }
  .footer-langs a:hover { color: #2563eb; }
  .footer-lang-active { margin: 0 0.15rem; color: #2563eb; font-weight: 600; }
  .card {
    background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
    padding: 1.5rem; margin-bottom: 1rem;
  }
  h1 { font-size: 1.3rem; margin-top: 0; }
  label { display: block; margin: 0.8rem 0 0.3rem; font-weight: 500; }
  input[type=text], input[type=password], input[type=number], textarea {
    width: 100%; padding: 0.6rem; border: 1px solid #ccc; border-radius: 4px;
    font-size: 1rem;
  }
  textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9rem; resize: vertical; }
  input[type=text]:focus, input[type=password]:focus, input[type=number]:focus, select:focus, textarea:focus {
    outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }
  select {
    width: 100%; padding: 0.6rem 2rem 0.6rem 0.6rem; border: 1px solid #ccc; border-radius: 4px;
    font-size: 1rem; background-color: #fff; color: #1a1a1a; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23666'%3E%3Cpath d='M5.5 7.5l4.5 4.5 4.5-4.5' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 0.6rem center; background-size: 1rem;
  }
  select:hover { border-color: #999; }
  button {
    margin-top: 1rem; padding: 0.6rem 1.2rem; border: none; border-radius: 4px;
    background: #2563eb; color: #fff; font-size: 1rem; cursor: pointer;
  }
  button:hover { background: #1d4ed8; }
  button.danger { background: #dc2626; }
  button.danger:hover { background: #b91c1c; }
  .error { color: #b91c1c; margin: 0.5rem 0; }
  .notice { color: #15803d; margin: 0.5rem 0; }
  code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
  .muted { color: #666; font-size: 0.9rem; }
  .badge {
    display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px;
    font-size: 0.85rem; font-weight: 600; text-transform: capitalize;
  }
  .badge-running { background: #dcfce7; color: #15803d; }
  .badge-stopped { background: #f3f4f6; color: #4b5563; }
  .badge-missing { background: #fee2e2; color: #b91c1c; }
  .badge-unknown { background: #fef9c3; color: #854d0e; }
  .btn-sm { margin: 0 0.2rem 0 0; padding: 0.3rem 0.7rem; font-size: 0.85rem; }
  .btn-warn { background: #dc2626; }
  .btn-warn:hover { background: #b91c1c; }
  button:disabled { background: #cbd5e1; cursor: not-allowed; }
  .actions { display: flex; align-items: center; gap: 0.5rem; }
  table.kv th { text-align: left; width: 160px; color: #555; font-weight: 600; vertical-align: top; }
  table.kv td { word-break: break-all; }
  h2 { font-size: 1.1rem; margin-top: 0; }
  fieldset { border: 1px solid #e0e0e0; border-radius: 6px; margin: 1.2rem 0; padding: 0.5rem 1rem 1rem; }
  legend { font-weight: 600; color: #374151; padding: 0 0.4rem; }
  .field { margin: 0.6rem 0; }
  .field label { margin: 0 0 0.25rem; }
  .field-help { display: block; font-size: 0.8rem; color: #6b7280; margin-top: 0.2rem; }
  .field-toggle label { display: flex; align-items: center; gap: 0.4rem; font-weight: 400; margin: 0.4rem 0; }
  .field-toggle input { width: auto; margin: 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
  .tabs {
    display: flex; flex-wrap: nowrap; gap: 0.2rem; border-bottom: 1px solid #e0e0e0;
    margin-bottom: 1.2rem; overflow-x: auto;
  }
  .tab-btn {
    margin: 0; padding: 0.6rem 0.8rem; border: none; border-bottom: 2px solid transparent;
    background: none; color: #555; font-size: 0.95rem; cursor: pointer; border-radius: 0;
    white-space: nowrap; flex: 0 0 auto;
  }
  .tab-btn:hover { color: #1a1a1a; background: #f4f5f7; }
  .tab-btn.active { color: #2563eb; border-bottom-color: #2563eb; font-weight: 600; }
  .tab-panel[hidden] { display: none; }
`;

function langSwitcherHtml(lang) {
  const links = i18n
    .langList()
    .map((l) =>
      l.code === lang
        ? `<span class="footer-lang-active">${escapeHtml(l.name)}</span>`
        : `<a href="?lang=${encodeURIComponent(l.code)}">${escapeHtml(l.name)}</a>`
    )
    .join(' · ');
  return `<div class="footer-langs">${links}</div>`;
}

function layout({ title, body, showNav = false, username = '', loginChrome = false, lang = 'en' }) {
  // Nav links + logout only render once authenticated. The login page skips
  // this generic header entirely - it gets its own logo+brand block instead
  // (see main.login-wrap below), matching the sibling phpopenvpnadmin
  // project's login layout (vpn.fordo.eu/login.php).
  const header = loginChrome
    ? ''
    : `<header>
         <span class="brand">${escapeHtml(BRAND_NAME)}</span>
         ${
           showNav
             ? `<nav>
           <a href="/dashboard">${escapeHtml(i18n.t(lang, 'nav.dashboard'))}</a>
           &nbsp;|&nbsp;
           <a href="/vms/new">${escapeHtml(i18n.t(lang, 'nav.createVm'))}</a>
           &nbsp;|&nbsp;
           <a href="/disks">${escapeHtml(i18n.t(lang, 'nav.disks'))}</a>
           &nbsp;|&nbsp;
           <a href="/cloud-init">${escapeHtml(i18n.t(lang, 'nav.cloudInit'))}</a>
           &nbsp;|&nbsp;
           <a href="/networks">${escapeHtml(i18n.t(lang, 'nav.networks'))}</a>
           &nbsp;|&nbsp;
           <a href="/host">${escapeHtml(i18n.t(lang, 'nav.host'))}</a>
           &nbsp;|&nbsp;
           <span>${escapeHtml(username)}</span>
           <form method="POST" action="/logout" style="display:inline">
             <button type="submit" style="background:none;color:#9ecbff;padding:0;margin:0;font-size:1rem">${escapeHtml(i18n.t(lang, 'nav.logout'))}</button>
           </form>
         </nav>`
             : ''
         }
       </header>`;

  const main = loginChrome
    ? `<main class="login-wrap">
         <div class="login-outer">
           <div class="login-header">
             <img src="/public/favicon.svg" alt="logo" height="48">
             <div class="login-app-name">${escapeHtml(BRAND_NAME)}</div>
           </div>
           ${body}
         </div>
       </main>`
    : `<main>${body}</main>`;

  const footer = `<footer>
    <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(PRODUCT_NAME)}</a> ${escapeHtml(i18n.t(lang, 'footer.onGithub'))}
    ${langSwitcherHtml(lang)}
  </footer>`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — ${escapeHtml(BRAND_NAME)}</title>
  <link rel="icon" type="image/svg+xml" href="/public/favicon.svg">
  <style>${BASE_CSS}</style>
</head>
<body>
  ${header}
  ${main}
  ${footer}
</body>
</html>`;
}

module.exports = { layout, escapeHtml, PRODUCT_NAME, BRAND_NAME, REPO_URL };
