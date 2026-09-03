'use strict';

const { layout, escapeHtml } = require('./layout');
const i18n = require('../lib/i18n');

// Login page. `error` and `username` are optional (shown after a failed
// attempt so the user doesn't have to retype the username). Layout is the
// login-wrap/login-header/login-box structure (see layout()'s loginChrome
// option) - matches the sibling phpopenvpnadmin project's login page
// (vpn.fordo.eu/login.php) rather than the generic nav+card chrome used
// everywhere else in this app. `error` is passed pre-translated by the
// caller (server.js) since it needs req.lang, which this function doesn't
// have direct access to beyond the `lang` param used for its own strings.
function loginPage({ error = '', username = '', lang = 'en' } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const body = `
    <div class="login-box">
      <h1>${escapeHtml(i18n.t(lang, 'login.title'))}</h1>
      ${errorHtml}
      <form method="POST" action="/login">
        <label>${escapeHtml(i18n.t(lang, 'login.username'))}
          <input type="text" name="username" autocomplete="username" value="${escapeHtml(username)}" autofocus required>
        </label>
        <label>${escapeHtml(i18n.t(lang, 'login.password'))}
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button type="submit">${escapeHtml(i18n.t(lang, 'login.submit'))}</button>
      </form>
    </div>`;
  return layout({ title: i18n.t(lang, 'login.title'), body, showNav: false, loginChrome: true, lang });
}

module.exports = { loginPage };
