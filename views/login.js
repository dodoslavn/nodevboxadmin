'use strict';

const { layout, escapeHtml, PRODUCT_NAME, INSTANCE_NAME } = require('./layout');

// Login page. `error` and `username` are optional (shown after a failed
// attempt so the user doesn't have to retype the username).
function loginPage({ error = '', username = '' } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  // Always names the tool itself, plus the per-instance name if one is
  // configured (see lib/config.js INSTANCE_NAME) - lets you tell instances
  // apart before even logging in, if you run more than one.
  const subtitle = INSTANCE_NAME
    ? `${escapeHtml(PRODUCT_NAME)} — ${escapeHtml(INSTANCE_NAME)}`
    : escapeHtml(PRODUCT_NAME);
  const body = `
    <div class="card">
      <h1>Sign in</h1>
      <p class="muted">${subtitle}</p>
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
