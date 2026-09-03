'use strict';

const { layout, escapeHtml } = require('./layout');
const i18n = require('../lib/i18n');

// VM Templates: existing VMs marked as clone sources (see lib/vmtemplates.js).
// Not to be confused with the unrelated cloud-config templates on the
// Cloud-Init page - both are called "templates" but are different features.
//
// Note: `tr` (not `t`) is used below for the translation helper, since `t`
// is already used as the loop variable name for template records.
function markedTemplateRows(markedTemplates, tr) {
  if (!markedTemplates.length) return `<tr><td colspan="4"><em>${escapeHtml(tr('createVm.noTemplatesMarked'))}</em></td></tr>`;
  return markedTemplates
    .map(
      (t) => `
      <tr>
        <td>${t.name ? escapeHtml(t.name) : `<span class="muted">(${escapeHtml(tr('createVm.vmNotFound'))})</span>`}</td>
        <td>${escapeHtml(t.note || '')}</td>
        <td>${escapeHtml(new Date(t.markedAt).toLocaleString())}</td>
        <td>
          <form method="POST" action="/vm-templates/${encodeURIComponent(t.uuid)}/unmark" style="display:inline">
            <button type="submit" class="btn-sm danger">${escapeHtml(tr('createVm.unmark'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function createFromTemplateCard(templates, tr) {
  if (!templates.length) {
    return `
    <div class="card">
      <h2>${escapeHtml(tr('createVm.fromTemplateTitle'))}</h2>
      <p class="muted">${escapeHtml(tr('createVm.noTemplatesYet'))}</p>
    </div>`;
  }
  const options = templates.map((t) => `<option value="${escapeHtml(t.uuid)}">${escapeHtml(t.name)}</option>`).join('');
  return `
    <div class="card">
      <h2>${escapeHtml(tr('createVm.fromTemplateTitle'))}</h2>
      <p class="muted">${escapeHtml(tr('createVm.fromTemplateDesc'))}</p>
      <form method="POST" action="/vm-templates/create">
        <div class="grid">
          <div class="field"><label>${escapeHtml(tr('createVm.template'))}</label><select name="templateUuid">${options}</select></div>
          <div class="field"><label>${escapeHtml(tr('createVm.newVmName'))}</label><input type="text" name="name" maxlength="64" required placeholder="e.g. web02"></div>
        </div>
        <button type="submit">${escapeHtml(tr('createVm.createFromTemplateBtn'))}</button>
      </form>
    </div>`;
}

function manageTemplatesCard(allVms, markedTemplates, tr) {
  const markForm = allVms.length
    ? `
      <form method="POST" action="/vm-templates/mark">
        <div class="grid">
          <div class="field"><label>VM</label><select name="uuid">${allVms
            .map((v) => `<option value="${escapeHtml(v.uuid)}">${escapeHtml(v.name)}</option>`)
            .join('')}</select></div>
          <div class="field"><label>${escapeHtml(tr('createVm.noteOptional'))}</label><input type="text" name="note" maxlength="200" placeholder="e.g. Debian 13 base image"></div>
        </div>
        <button type="submit">${escapeHtml(tr('createVm.markAsTemplateBtn'))}</button>
      </form>`
    : `<p class="muted">${escapeHtml(tr('createVm.noVmsToMark'))}</p>`;

  return `
    <div class="card">
      <h2>${escapeHtml(tr('createVm.manageTemplatesTitle'))}</h2>
      <p class="muted">${escapeHtml(tr('createVm.manageTemplatesDesc'))}</p>
      ${markForm}
      <table style="margin-top:1rem">
        <thead><tr><th>VM</th><th>${escapeHtml(tr('createVm.note'))}</th><th>${escapeHtml(tr('createVm.marked'))}</th><th></th></tr></thead>
        <tbody>${markedTemplateRows(markedTemplates, tr)}</tbody>
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
  lang = 'en',
} = {}) {
  const tr = (key, vars) => i18n.t(lang, key, vars);
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';
  const body = `
    <p><a href="/dashboard">&larr; ${escapeHtml(tr('createVm.backToDashboard'))}</a></p>
    ${errorHtml}
    ${noticeHtml}
    <div class="card">
      <h1>${escapeHtml(tr('createVm.title'))}</h1>
      <h2>${escapeHtml(tr('createVm.blankVm'))}</h2>
      <p class="muted">${escapeHtml(tr('createVm.blankVmDesc'))}</p>
      <form method="POST" action="/vms/new">
        <label for="name">${escapeHtml(tr('createVm.name'))}</label>
        <input type="text" id="name" name="name" maxlength="64" required
               value="${escapeHtml(form.name || '')}" placeholder="e.g. my-test-vm" autofocus>
        <button type="submit">${escapeHtml(tr('createVm.createVmBtn'))}</button>
      </form>
    </div>

    ${createFromTemplateCard(templates, tr)}
    ${manageTemplatesCard(allVms, markedTemplates, tr)}`;
  return layout({ title: tr('createVm.title'), body, showNav: true, username, lang });
}

module.exports = { createVmPage };
