'use strict';

const { layout, escapeHtml } = require('./layout');

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

function templateDeleteRows(templates) {
  if (!templates.length) return '';
  const rows = templates
    .map(
      (t) => `
      <tr>
        <td>${escapeHtml(t.name)}</td>
        <td>
          <form method="POST" action="/cloud-init/templates/${encodeURIComponent(t.id)}/delete" style="display:inline"
                data-confirm-delete-template="${escapeHtml(t.name)}">
            <button type="submit" class="btn-sm danger">Delete</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
  return `
    <table>
      <thead><tr><th>Saved template</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function isoRows(isos) {
  if (!isos.length) return '<tr><td colspan="4"><em>No ISOs generated yet.</em></td></tr>';
  return isos
    .map(
      (iso) => `
      <tr>
        <td style="word-break:break-all">${escapeHtml(iso.path)}</td>
        <td>${escapeHtml(formatBytes(iso.sizeBytes))}</td>
        <td>${escapeHtml(new Date(iso.mtime).toLocaleString())}</td>
        <td>
          <form method="POST" action="/cloud-init/isos/${encodeURIComponent(iso.filename)}/delete" style="display:inline"
                data-confirm-delete-iso="${escapeHtml(iso.filename)}">
            <button type="submit" class="btn-sm danger">Delete</button>
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
} = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';
  const templatesJson = escapeHtml(JSON.stringify(templates));

  const body = `
    <div class="card">
      <h1>Cloud-Init</h1>
      <p class="muted">Build NoCloud seed ISOs for unattended VM installs. Edit the cloud-config below (use <code>{{HOSTNAME}}</code> as a placeholder - it's filled in per-build from meta-data's <code>local-hostname</code>), save it as a reusable template, then generate an ISO from it.</p>
      ${errorHtml}
      ${noticeHtml}

      <form method="POST" id="cloud-init-form" data-templates="${templatesJson}">
        <div class="field">
          <label>Load a saved template</label>
          <select id="cloud-init-template-select">
            <option value="">— new / unsaved —</option>
            ${templateOptions(templates)}
          </select>
        </div>
        <input type="hidden" name="id" id="cloud-init-template-id" value="">
        <div class="grid">
          <div class="field"><label>Template name</label><input type="text" name="name" id="cloud-init-template-name" maxlength="64" placeholder="e.g. debian-generic"></div>
          <div class="field"><label>Output name</label><input type="text" name="outputName" maxlength="64" placeholder="e.g. web01" required></div>
        </div>
        <div class="field">
          <label>Cloud-config (user-data)</label>
          <textarea name="userData" id="cloud-init-userdata" rows="18">${escapeHtml(defaultTemplate)}</textarea>
          <span class="field-help">Standard #cloud-config YAML - same format as any cloud-init NoCloud seed.</span>
        </div>
        <div class="field">
          <label>Meta-data (JSON)</label>
          <textarea name="metaData" id="cloud-init-metadata" rows="4">${escapeHtml(defaultMetaData)}</textarea>
          <span class="field-help"><code>instance-id</code> is always regenerated on build regardless of what's here, so cloud-init reliably re-runs on the new ISO. Set <code>local-hostname</code> here - it's the single source of truth for hostname, also used to fill <code>{{HOSTNAME}}</code> above.</span>
        </div>
        <div class="field">
          <label>Network-config (optional)</label>
          <textarea name="networkConfig" id="cloud-init-networkconfig" rows="4" placeholder="version: 2&#10;ethernets:&#10;  enp0s3:&#10;    dhcp4: true"></textarea>
          <span class="field-help">Standard cloud-init network-config YAML. Leave blank to omit - cloud-init falls back to its own default (typically DHCP on all interfaces).</span>
        </div>
        <div class="actions">
          <button type="submit" formaction="/cloud-init/templates/save">Save template</button>
          <button type="submit" formaction="/cloud-init/build">Generate ISO</button>
        </div>
      </form>

      ${templateDeleteRows(templates)}
    </div>

    <div class="card">
      <h2>Generated ISOs</h2>
      <table>
        <thead><tr><th>Path</th><th>Size</th><th>Created</th><th></th></tr></thead>
        <tbody>${isoRows(isos)}</tbody>
      </table>
    </div>

    <script src="/public/cloudinit.js" defer></script>`;

  return layout({ title: 'Cloud-Init', body, showNav: true, username });
}

module.exports = { cloudInitPage };
