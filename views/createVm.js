'use strict';

const { layout, escapeHtml } = require('./layout');

// "Create a new VM" page. Creates a blank VM in VirtualBox (no disk/OS).
function createVmPage({ username = '', error = '', form = {} } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const body = `
    <p><a href="/dashboard">&larr; Back to dashboard</a></p>
    <div class="card">
      <h1>Create a new VM</h1>
      <p class="muted">Creates a blank virtual machine in VirtualBox (no disk or OS yet) with default memory (2048 MB) and 1 CPU. You can add a disk, install an operating system, and change memory/CPUs afterwards on the Edit page.</p>
      ${errorHtml}
      <form method="POST" action="/vms/new">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" maxlength="64" required
               value="${escapeHtml(form.name || '')}" placeholder="e.g. my-test-vm" autofocus>
        <button type="submit">Create VM</button>
      </form>
    </div>`;
  return layout({ title: 'Create VM — nodevboxadmin', body, showNav: true, username });
}

module.exports = { createVmPage };
