'use strict';

const { layout, escapeHtml, BRAND_NAME } = require('./layout');

// Login page. `error` and `username` are optional (shown after a failed
// attempt so the user doesn't have to retype the username).
function loginPage({ error = '', username = '' } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const body = `
    <div class="card">
      <h1>Sign in</h1>
      <p class="muted">${escapeHtml(BRAND_NAME)}</p>
      ${errorHtml}
      <form method="POST" action="/login">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" value="${escapeHtml(username)}" autofocus required>
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required>
        <button type="submit">Sign in</button>
      </form>
    </div>`;
  return layout({ title: 'Sign in', body, showNav: false });
}

module.exports = { loginPage };
