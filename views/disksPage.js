'use strict';

const { layout, escapeHtml } = require('./layout');
const i18n = require('../lib/i18n');

// Host-wide virtual media page: every disk/ISO/floppy VirtualBox knows
// about, whether or not it's currently attached to a VM. Complements (does
// not replace) the per-VM Storage tab in views/editVm.js, which is where
// attach/detach for a *specific* VM's controllers still happens.

function kindLabels(tr) {
  return { disk: tr('disks.hardDisk'), dvd: tr('disks.dvdIso'), floppy: tr('disks.floppy') };
}

// "In use by VMs" lines look like "wwww (UUID: b6d0c561-...)" - pull the
// name/uuid apart so the name can link to that VM's edit page.
function parseInUseEntry(s) {
  const m = /^(.*)\s+\(UUID:\s*([0-9a-fA-F-]+)\)\s*$/.exec(s);
  return m ? { name: m[1].trim(), uuid: m[2] } : { name: s, uuid: null };
}

// For an attached medium, shows which VM(s) it's on (linked). A medium is
// normally attached in exactly one place; the loop just covers the rare
// multi-attach case rather than assuming one.
function usedByHtml(m, tr) {
  if (!m.inUseByVMs || !m.inUseByVMs.length) return `<span class="muted">${escapeHtml(tr('disks.notAttached'))}</span>`;
  return m.inUseByVMs
    .map((s) => {
      const { name, uuid } = parseInUseEntry(s);
      return uuid ? `<a href="/vms/${encodeURIComponent(uuid)}/edit">${escapeHtml(name)}</a>` : escapeHtml(name);
    })
    .join(', ');
}

// One Detach button per attachment, in its own column (previously inline
// with the VM name in the "Attached to" column).
function detachButtonsHtml(m, tr) {
  if (!m.inUseByVMs || !m.inUseByVMs.length) return '';
  return m.inUseByVMs
    .map((s) => {
      const { uuid } = parseInUseEntry(s);
      if (!uuid) return '';
      return `
        <form method="POST" action="/disks/${m.kind}/${encodeURIComponent(m.UUID)}/detach" style="display:inline"
              data-confirm-detach-disk="${escapeHtml(tr('disks.confirmDetach', { path: m.Location || m.UUID }))}">
          <input type="hidden" name="vmUuid" value="${escapeHtml(uuid)}">
          <button type="submit" class="btn-sm btn-warn">${escapeHtml(tr('disks.detach'))}</button>
        </form>`;
    })
    .join('');
}

function mediaRows(media, tr) {
  if (!media.length) return `<tr><td colspan="6"><em>${escapeHtml(tr('disks.noMedia'))}</em></td></tr>`;
  const labels = kindLabels(tr);
  return media
    .map((m) => {
      const attached = m.inUseByVMs && m.inUseByVMs.length;
      const deleteAction = attached
        ? `<span class="muted">${escapeHtml(tr('disks.detachFirst'))}</span>`
        : `
          <form method="POST" action="/disks/${m.kind}/${encodeURIComponent(m.UUID)}/delete" style="display:inline"
                data-confirm-delete-medium="${escapeHtml(tr('disks.confirmRemoveMedium', { path: m.Location || m.UUID }))}">
            <button type="submit" class="btn-sm danger">${escapeHtml(tr('disks.remove'))}</button>
          </form>`;
      const missingBadge = m.existsOnDisk
        ? ''
        : ` <span class="badge badge-missing" title="${escapeHtml(tr('disks.missingTitle'))}">${escapeHtml(tr('disks.missing'))}</span>`;
      return `
      <tr>
        <td>${escapeHtml(labels[m.kind] || m.kind)}</td>
        <td style="word-break:break-all">${escapeHtml(m.Location || '')}${missingBadge}</td>
        <td>${escapeHtml(m.Capacity || '')}</td>
        <td>${usedByHtml(m, tr)}</td>
        <td>${detachButtonsHtml(m, tr)}</td>
        <td>${deleteAction}</td>
      </tr>`;
    })
    .join('');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function libraryRows(files, kind, tr) {
  return files
    .map(
      (f) => `
      <tr>
        <td style="word-break:break-all">${escapeHtml(f.path)}</td>
        <td>${escapeHtml(formatBytes(f.sizeBytes))}</td>
        <td>${escapeHtml(new Date(f.mtime).toLocaleString())}</td>
        <td>
          <form method="POST" action="/disks/register" style="display:inline">
            <input type="hidden" name="path" value="${escapeHtml(f.path)}">
            <input type="hidden" name="kind" value="${kind}">
            <button type="submit" class="btn-sm">${escapeHtml(tr('disks.addToVirtualBox'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function libraryCard({ title, dirLabel, dir, files, kind, tr }) {
  let body;
  if (!dir) {
    body = `<p class="muted">${tr('disks.notConfigured', { setting: `<code>${escapeHtml(dirLabel)}</code>` })}</p>`;
  } else if (!files.length) {
    body = `<p class="muted">${tr('disks.noFilesFound', { dir: `<code>${escapeHtml(dir)}</code>` })}</p>`;
  } else {
    body = `
      <table>
        <thead><tr><th>${escapeHtml(tr('disks.path'))}</th><th>${escapeHtml(tr('disks.size'))}</th><th>${escapeHtml(tr('disks.modified'))}</th><th></th></tr></thead>
        <tbody>${libraryRows(files, kind, tr)}</tbody>
      </table>`;
  }
  return `<div class="card"><h2>${escapeHtml(title)}</h2>${body}</div>`;
}

function registerDiskCard(tr) {
  return `
    <div class="card">
      <h2>${escapeHtml(tr('disks.registerTitle'))}</h2>
      <p class="muted">${escapeHtml(tr('disks.registerDesc'))}</p>
      <form method="POST" action="/disks/register">
        <div class="grid">
          <div class="field"><label>${escapeHtml(tr('disks.path'))}</label><input type="text" name="path" required placeholder="/path/to/disk.vdi"></div>
          <div class="field">
            <label>${escapeHtml(tr('disks.type'))}</label>
            <select name="kind">
              <option value="disk">${escapeHtml(tr('disks.hardDisk'))}</option>
              <option value="dvd">${escapeHtml(tr('disks.dvdIso'))}</option>
              <option value="floppy">${escapeHtml(tr('disks.floppy'))}</option>
            </select>
          </div>
        </div>
        <button type="submit">${escapeHtml(tr('disks.registerBtn'))}</button>
      </form>
    </div>`;
}

function disksPage({
  media = [], isoLibrary = [], diskLibrary = [], isoLibraryDir = '', diskLibraryDir = '',
  diskFormats = [], username = '', error = '', notice = '', lang = 'en',
} = {}) {
  const tr = (key, vars) => i18n.t(lang, key, vars);
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';
  const formatOpts = diskFormats.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');

  const body = `
    <div class="card">
      <h1>${escapeHtml(tr('disks.title'))}</h1>
      <p class="muted">${escapeHtml(tr('disks.subtitle'))}</p>
      ${errorHtml}
      ${noticeHtml}
      <table>
        <thead><tr><th>${escapeHtml(tr('disks.type'))}</th><th>${escapeHtml(tr('disks.path'))}</th><th>${escapeHtml(tr('disks.size'))}</th><th>${escapeHtml(tr('disks.attachedTo'))}</th><th></th><th></th></tr></thead>
        <tbody>${mediaRows(media, tr)}</tbody>
      </table>
    </div>

    ${registerDiskCard(tr)}

    ${libraryCard({ title: tr('disks.isoLibrary'), dirLabel: 'ISO_LIBRARY_DIR', dir: isoLibraryDir, files: isoLibrary, kind: 'dvd', tr })}

    ${libraryCard({ title: tr('disks.diskImageLibrary'), dirLabel: 'DISK_LIBRARY_DIR', dir: diskLibraryDir, files: diskLibrary, kind: 'disk', tr })}

    <div class="card">
      <h2>${escapeHtml(tr('disks.createNewDisk'))}</h2>
      <p class="muted">${escapeHtml(tr('disks.createNewDiskDesc'))}</p>
      <form method="POST" action="/disks/create">
        <div class="grid">
          <div class="field"><label>${escapeHtml(tr('disks.folder'))}</label><input type="text" name="folder" required placeholder="/home/virtualbox/disks"></div>
          <div class="field"><label>${escapeHtml(tr('common.name'))}</label><input type="text" name="name" maxlength="64" required placeholder="e.g. spare-disk"></div>
        </div>
        <div class="grid">
          <div class="field"><label>${escapeHtml(tr('disks.sizeMb'))}</label><input type="number" name="sizeMB" min="1" max="2000000" value="20000"></div>
          <div class="field"><label>${escapeHtml(tr('disks.format'))}</label><select name="format">${formatOpts}</select></div>
        </div>
        <button type="submit">${escapeHtml(tr('disks.createDiskBtn'))}</button>
      </form>
    </div>

    <script src="/public/disks.js" defer></script>`;

  return layout({ title: tr('disks.title'), body, showNav: true, username, lang });
}

module.exports = { disksPage };
