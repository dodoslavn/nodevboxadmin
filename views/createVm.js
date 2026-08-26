'use strict';

const { layout, escapeHtml } = require('./layout');

// VM Templates: existing VMs marked as clone sources (see lib/vmtemplates.js).
// Not to be confused with the unrelated cloud-config templates on the
// Cloud-Init page - both are called "templates" but are different features.
function markedTemplateRows(markedTemplates) {
  if (!markedTemplates.length) return '<tr><td colspan="4"><em>No templates marked yet.</em></td></tr>';
  return markedTemplates
    .map(
      (t) => `
      <tr>
        <td>${t.name ? escapeHtml(t.name) : '<span class="muted">(VM not found)</span>'}</td>
        <td>${escapeHtml(t.note || '')}</td>
        <td>${escapeHtml(new Date(t.markedAt).toLocaleString())}</td>
        <td>
          <form method="POST" action="/vm-templates/${encodeURIComponent(t.uuid)}/unmark" style="display:inline">
            <button type="submit" class="btn-sm danger">Unmark</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function createFromTemplateCard(templates) {
  if (!templates.length) {
    return `
    <div class="card">
      <h2>Create from a template</h2>
      <p class="muted">No templates marked yet - mark an existing VM as a template below.</p>
    </div>`;
  }
  const options = templates.map((t) => `<option value="${escapeHtml(t.uuid)}">${escapeHtml(t.name)}</option>`).join('');
  return `
    <div class="card">
      <h2>Create from a template</h2>
      <p class="muted">Clones the selected template into a new, fully independent VM (its own disk - the template itself is never modified).</p>
      <form method="POST" action="/vm-templates/create">
        <div class="grid">
          <div class="field"><label>Template</label><select name="templateUuid">${options}</select></div>
          <div class="field"><label>New VM name</label><input type="text" name="name" maxlength="64" required placeholder="e.g. web02"></div>
        </div>
        <button type="submit">Create VM from template</button>
      </form>
    </div>`;
}

function manageTemplatesCard(allVms, markedTemplates) {
  const markForm = allVms.length
    ? `
      <form method="POST" action="/vm-templates/mark">
        <div class="grid">
          <div class="field"><label>VM</label><select name="uuid">${allVms
            .map((v) => `<option value="${escapeHtml(v.uuid)}">${escapeHtml(v.name)}</option>`)
            .join('')}</select></div>
          <div class="field"><label>Note (optional)</label><input type="text" name="note" maxlength="200" placeholder="e.g. Debian 13 base image"></div>
        </div>
        <button type="submit">Mark as template</button>
      </form>`
    : '<p class="muted">No VMs exist yet to mark as a template.</p>';

  return `
    <div class="card">
      <h2>Manage templates</h2>
      <p class="muted">Mark an existing VM (ideally powered off) as a template others can be cloned from.</p>
      ${markForm}
      <table style="margin-top:1rem">
        <thead><tr><th>VM</th><th>Note</th><th>Marked</th><th></th></tr></thead>
        <tbody>${markedTemplateRows(markedTemplates)}</tbody>
      </table>
    </div>`;
}

// "Create a new VM" page: a blank VM, from a template, or manage templates.
function createVmPage({
  username = '',
  error = '',
  notice = '',
  form = {},
  templates = [],
  allVms = [],
  markedTemplates = [],
} = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';
  const body = `
    <p><a href="/dashboard">&larr; Back to dashboard</a></p>
    ${errorHtml}
    ${noticeHtml}
    <div class="card">
      <h1>Create a new VM</h1>
      <h2>Blank VM</h2>
      <p class="muted">Creates a blank virtual machine in VirtualBox (no disk or OS yet) with default memory (2048 MB) and 1 CPU. You can add a disk, install an operating system, and change memory/CPUs afterwards on the Edit page.</p>
      <form method="POST" action="/vms/new">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" maxlength="64" required
               value="${escapeHtml(form.name || '')}" placeholder="e.g. my-test-vm" autofocus>
        <button type="submit">Create VM</button>
      </form>
    </div>

    ${createFromTemplateCard(templates)}
    ${manageTemplatesCard(allVms, markedTemplates)}`;
  return layout({ title: 'Create VM', body, showNav: true, username });
}

module.exports = { createVmPage };
