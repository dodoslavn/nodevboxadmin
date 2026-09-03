'use strict';

const { layout, escapeHtml } = require('./layout');
const i18n = require('../lib/i18n');

// Cloud-init seed ISO builder. One form serves both "Save template" and
// "Generate ISO" (two submit buttons with different formaction) so the
// same textarea backs both actions without duplicating it or copying its
// value via JS - see public/cloudinit.js for the template-select-fills-
// textarea and mount-redirect behavior, neither of which needs a real
// submit.

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function templateOptions(templates) {
  return templates
    .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
    .join('');
}

function templateDeleteRows(templates, tr) {
  if (!templates.length) return '';
  const rows = templates
    .map(
      (t) => `
      <tr>
        <td>${escapeHtml(t.name)}</td>
        <td>
          <form method="POST" action="/cloud-init/templates/${encodeURIComponent(t.id)}/delete" style="display:inline"
                data-confirm-delete-template="${escapeHtml(tr('cloudInit.confirmDeleteTemplate', { name: t.name }))}">
            <button type="submit" class="btn-sm danger">${escapeHtml(tr('common.delete'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
  return `
    <table>
      <thead><tr><th>${escapeHtml(tr('cloudInit.savedTemplate'))}</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function isoRows(isos, tr) {
  if (!isos.length) return `<tr><td colspan="4"><em>${escapeHtml(tr('cloudInit.noIsosYet'))}</em></td></tr>`;
  return isos
    .map(
      (iso) => `
      <tr>
        <td style="word-break:break-all">${escapeHtml(iso.path)}</td>
        <td>${escapeHtml(formatBytes(iso.sizeBytes))}</td>
        <td>${escapeHtml(new Date(iso.mtime).toLocaleString())}</td>
        <td>
          <form method="POST" action="/cloud-init/isos/${encodeURIComponent(iso.filename)}/delete" style="display:inline"
                data-confirm-delete-iso="${escapeHtml(tr('cloudInit.confirmDeleteIso', { name: iso.filename }))}">
            <button type="submit" class="btn-sm danger">${escapeHtml(tr('common.delete'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function cloudInitPage({
  templates = [],
  isos = [],
  defaultTemplate = '',
  defaultMetaData = '',
  username = '',
  error = '',
  notice = '',
  lang = 'en',
} = {}) {
  const tr = (key, vars) => i18n.t(lang, key, vars);
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';
  const templatesJson = escapeHtml(JSON.stringify(templates));

  const body = `
    <div class="card">
      <h1>${tr('nav.cloudInit')}</h1>
      <p class="muted">${tr('cloudInit.intro', { hostnameCode: '<code>{{HOSTNAME}}</code>', localHostnameCode: '<code>local-hostname</code>' })}</p>
      ${errorHtml}
      ${noticeHtml}

      <form method="POST" id="cloud-init-form" data-templates="${templatesJson}">
        <div class="field">
          <label>${escapeHtml(tr('cloudInit.loadTemplate'))}</label>
          <select id="cloud-init-template-select">
            <option value="">${escapeHtml(tr('cloudInit.newUnsaved'))}</option>
            ${templateOptions(templates)}
          </select>
        </div>
        <input type="hidden" name="id" id="cloud-init-template-id" value="">
        <div class="field">
          <label>${escapeHtml(tr('cloudInit.templateName'))}</label>
          <input type="text" name="name" id="cloud-init-template-name" maxlength="64" placeholder="e.g. debian-generic">
        </div>
        <div class="field">
          <label>${escapeHtml(tr('cloudInit.cloudConfig'))}</label>
          <textarea name="userData" id="cloud-init-userdata" rows="18">${escapeHtml(defaultTemplate)}</textarea>
          <span class="field-help">${escapeHtml(tr('cloudInit.cloudConfigHelp'))}</span>
        </div>
        <div class="field">
          <label>${escapeHtml(tr('cloudInit.metaData'))}</label>
          <textarea name="metaData" id="cloud-init-metadata" rows="4">${escapeHtml(defaultMetaData)}</textarea>
          <span class="field-help">${tr('cloudInit.metaDataHelp', { instanceIdCode: '<code>instance-id</code>', localHostnameCode: '<code>local-hostname</code>', hostnameCode: '<code>{{HOSTNAME}}</code>' })}</span>
        </div>
        <div class="field">
          <label>${escapeHtml(tr('cloudInit.networkConfig'))}</label>
          <textarea name="networkConfig" id="cloud-init-networkconfig" rows="4" placeholder="version: 2&#10;ethernets:&#10;  enp0s3:&#10;    dhcp4: true"></textarea>
          <span class="field-help">${escapeHtml(tr('cloudInit.networkConfigHelp'))}</span>
        </div>
        <div class="actions" style="justify-content:flex-end">
          <button type="submit" formaction="/cloud-init/templates/save" formnovalidate>${escapeHtml(tr('cloudInit.saveTemplateBtn'))}</button>
        </div>
        <div class="field">
          <label>${escapeHtml(tr('cloudInit.isoName'))}</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input type="text" name="outputName" maxlength="64" placeholder="e.g. web01" required style="flex:1">
            <button type="submit" formaction="/cloud-init/build" style="margin-top:0">${escapeHtml(tr('cloudInit.generateIsoBtn'))}</button>
          </div>
          <span class="field-help">${tr('cloudInit.isoNameHelp', { isoNameCode: '<code>&lt;' + escapeHtml(tr('cloudInit.isoName')) + '&gt;.iso</code>' })}</span>
        </div>
      </form>

      ${templateDeleteRows(templates, tr)}
    </div>

    <div class="card">
      <h2>${escapeHtml(tr('cloudInit.generatedIsos'))}</h2>
      <table>
        <thead><tr><th>${escapeHtml(tr('disks.path'))}</th><th>${escapeHtml(tr('disks.size'))}</th><th>${escapeHtml(tr('cloudInit.created'))}</th><th></th></tr></thead>
        <tbody>${isoRows(isos, tr)}</tbody>
      </table>
    </div>

    <script src="/public/cloudinit.js" defer></script>`;

  return layout({ title: tr('nav.cloudInit'), body, showNav: true, username, lang });
}

module.exports = { cloudInitPage };
