'use strict';

const { layout, escapeHtml } = require('./layout');

// Host-wide virtual media page: every disk/ISO/floppy VirtualBox knows
// about, whether or not it's currently attached to a VM. Complements (does
// not replace) the per-VM Storage tab in views/editVm.js, which is where
// attach/detach for a *specific* VM's controllers still happens.

const KIND_LABELS = { disk: 'Hard disk', dvd: 'DVD/ISO', floppy: 'Floppy' };

// "In use by VMs" lines look like "wwww (UUID: b6d0c561-...)" - pull the
// name/uuid apart so the name can link to that VM's edit page.
function parseInUseEntry(s) {
  const m = /^(.*)\s+\(UUID:\s*([0-9a-fA-F-]+)\)\s*$/.exec(s);
  return m ? { name: m[1].trim(), uuid: m[2] } : { name: s, uuid: null };
}

// For an attached medium, shows which VM(s) it's on (linked). A medium is
// normally attached in exactly one place; the loop just covers the rare
// multi-attach case rather than assuming one.
function usedByHtml(m) {
  if (!m.inUseByVMs || !m.inUseByVMs.length) return '<span class="muted">Not attached</span>';
  return m.inUseByVMs
    .map((s) => {
      const { name, uuid } = parseInUseEntry(s);
      return uuid ? `<a href="/vms/${encodeURIComponent(uuid)}/edit">${escapeHtml(name)}</a>` : escapeHtml(name);
    })
    .join(', ');
}

// One Detach button per attachment, in its own column (previously inline
// with the VM name in the "Attached to" column).
function detachButtonsHtml(m) {
  if (!m.inUseByVMs || !m.inUseByVMs.length) return '';
  return m.inUseByVMs
    .map((s) => {
      const { uuid } = parseInUseEntry(s);
      if (!uuid) return '';
      return `
        <form method="POST" action="/disks/${m.kind}/${encodeURIComponent(m.UUID)}/detach" style="display:inline"
              data-confirm-detach-disk="${escapeHtml(m.Location || m.UUID)}">
          <input type="hidden" name="vmUuid" value="${escapeHtml(uuid)}">
          <button type="submit" class="btn-sm btn-warn">Detach</button>
        </form>`;
    })
    .join('');
}

function mediaRows(media) {
  if (!media.length) return '<tr><td colspan="6"><em>No virtual media registered.</em></td></tr>';
  return media
    .map((m) => {
      const attached = m.inUseByVMs && m.inUseByVMs.length;
      const deleteAction = attached
        ? '<span class="muted">Detach first to remove</span>'
        : `
          <form method="POST" action="/disks/${m.kind}/${encodeURIComponent(m.UUID)}/delete" style="display:inline"
                data-confirm-delete-medium="${escapeHtml(m.Location || m.UUID)}">
            <button type="submit" class="btn-sm danger">Remove</button>
          </form>`;
      const missingBadge = m.existsOnDisk
        ? ''
        : ' <span class="badge badge-missing" title="Registered with VirtualBox, but no file exists at this path">Missing</span>';
      return `
      <tr>
        <td>${escapeHtml(KIND_LABELS[m.kind] || m.kind)}</td>
        <td style="word-break:break-all">${escapeHtml(m.Location || '')}${missingBadge}</td>
        <td>${escapeHtml(m.Capacity || '')}</td>
        <td>${usedByHtml(m)}</td>
        <td>${detachButtonsHtml(m)}</td>
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

function libraryRows(files, kind) {
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
            <button type="submit" class="btn-sm">Add to VirtualBox</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function libraryCard({ title, dirLabel, dir, files, kind }) {
  let body;
  if (!dir) {
    body = `<p class="muted">Not configured - set <code>${escapeHtml(dirLabel)}</code> in <code>config/config.json</code>.</p>`;
  } else if (!files.length) {
    body = `<p class="muted">No files found in <code>${escapeHtml(dir)}</code>.</p>`;
  } else {
    body = `
      <table>
        <thead><tr><th>Path</th><th>Size</th><th>Modified</th><th></th></tr></thead>
        <tbody>${libraryRows(files, kind)}</tbody>
      </table>`;
  }
  return `<div class="card"><h2>${escapeHtml(title)}</h2>${body}</div>`;
}

function registerDiskCard() {
  return `
    <div class="card">
      <h2>Register an existing disk</h2>
      <p class="muted">Adds a disk/ISO/floppy file VirtualBox doesn't know about yet to the list above (registers it without attaching it to any VM). Use a VM's Edit &rarr; Storage tab to actually attach it afterward.</p>
      <form method="POST" action="/disks/register">
        <div class="grid">
          <div class="field"><label>Path</label><input type="text" name="path" required placeholder="/path/to/disk.vdi"></div>
          <div class="field">
            <label>Type</label>
            <select name="kind">
              <option value="disk">Hard disk</option>
              <option value="dvd">DVD/ISO</option>
              <option value="floppy">Floppy</option>
            </select>
          </div>
        </div>
        <button type="submit">Register</button>
      </form>
    </div>`;
}

function disksPage({
  media = [], isoLibrary = [], diskLibrary = [], isoLibraryDir = '', diskLibraryDir = '',
  diskFormats = [], username = '', error = '', notice = '', lang = 'en',
} = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';
  const formatOpts = diskFormats.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');

  const body = `
    <div class="card">
      <h1>Virtual media</h1>
      <p class="muted">Every disk, ISO, and floppy VirtualBox has registered on this host - including ones left behind after a VM only detached (rather than deleted) them. To attach a disk to a VM, use that VM's Edit &rarr; Storage tab; this page is for the host-wide inventory, detaching, and cleaning up orphans.</p>
      ${errorHtml}
      ${noticeHtml}
      <table>
        <thead><tr><th>Type</th><th>Path</th><th>Size</th><th>Attached to</th><th></th><th></th></tr></thead>
        <tbody>${mediaRows(media)}</tbody>
      </table>
    </div>

    ${registerDiskCard()}

    ${libraryCard({ title: 'ISO Library', dirLabel: 'ISO_LIBRARY_DIR', dir: isoLibraryDir, files: isoLibrary, kind: 'dvd' })}

    ${libraryCard({ title: 'Disk Image Library', dirLabel: 'DISK_LIBRARY_DIR', dir: diskLibraryDir, files: diskLibrary, kind: 'disk' })}

    <div class="card">
      <h2>Create a new disk</h2>
      <p class="muted">Creates a blank disk registered with VirtualBox but not attached to any VM yet - attach it from a VM's Storage tab.</p>
      <form method="POST" action="/disks/create">
        <div class="grid">
          <div class="field"><label>Folder</label><input type="text" name="folder" required placeholder="/home/virtualbox/disks"></div>
          <div class="field"><label>Name</label><input type="text" name="name" maxlength="64" required placeholder="e.g. spare-disk"></div>
        </div>
        <div class="grid">
          <div class="field"><label>Size (MB)</label><input type="number" name="sizeMB" min="1" max="2000000" value="20000"></div>
          <div class="field"><label>Format</label><select name="format">${formatOpts}</select></div>
        </div>
        <button type="submit">Create disk</button>
      </form>
    </div>

    <script src="/public/disks.js" defer></script>`;

  return layout({ title: 'Virtual media', body, showNav: true, username, lang });
}

module.exports = { disksPage };
