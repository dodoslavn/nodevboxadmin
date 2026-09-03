'use strict';

const { layout, escapeHtml } = require('./layout');

// VM detail page. Shows full VBox state, selected info fields, start/stop
// actions, a live screenshot (when running), and recent audit history for
// this VM. See ARCHITECTURE.md M7.
//
// `vm`      : registry entry { id, displayName, vboxUuid }
// `status`  : { present, state, running } (from vmstatus-style lookup)
// `info`    : parsed showvminfo object (may be null if not present/error)
// `history` : array of audit entries (newest first)
// `error`   : optional top-level error string

function stateBadge(state) {
  const cls =
    state === 'running' ? 'badge-running'
    : state === 'stopped' ? 'badge-stopped'
    : state === 'missing' ? 'badge-missing'
    : 'badge-unknown';
  return `<span class="badge ${cls}">${escapeHtml(state)}</span>`;
}

// The complete parsed output of `VBoxManage showvminfo --machinereadable`,
// every key/value, sorted alphabetically. Shown in full by default.
function allSettingsTable(info) {
  if (!info) return '<p class="muted">No VirtualBox info available.</p>';
  const keys = Object.keys(info).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const rows = keys
    .map((k) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(info[k]))}</td></tr>`)
    .join('');
  return `<table class="kv">${rows}</table>`;
}

function actionButtons(status) {
  if (!status.present) return '<span class="muted">VM not present in VirtualBox.</span>';
  const startDisabled = status.running ? 'disabled' : '';
  const stopDisabled = status.running ? '' : 'disabled';
  return `
    <div class="actions" data-role="actions">
      <button type="button" class="btn-sm" data-action="start" ${startDisabled}>Start</button>
      <button type="button" class="btn-sm btn-warn" data-action="stop" data-mode="acpi" ${stopDisabled}>Stop</button>
      <button type="button" class="btn-sm danger" data-action="stop" data-mode="hard" ${stopDisabled}>Force Stop</button>
    </div>`;
}

function screenshotBlock(vm, status) {
  if (!status.present) return '';
  if (!status.running) {
    return `<div class="card"><h2>Console</h2><p class="muted">Screenshot available when the VM is running.</p></div>`;
  }
  const src = `/vms/${encodeURIComponent(vm.uuid)}/screenshot.png`;
  return `
    <div class="card">
      <h2>Console</h2>
      <img id="vm-screenshot" alt="VM console screenshot"
           src="${src}?t=${Date.now()}" style="max-width:100%;border:1px solid #ddd;border-radius:4px">
      <p class="muted">Updates periodically while running.</p>
    </div>`;
}

function historyTable(history) {
  if (!history.length) return '<p class="muted">No actions recorded yet.</p>';
  const rows = history
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.ts || '')}</td>
        <td>${escapeHtml(e.action || '')}</td>
        <td>${escapeHtml(e.result || '')}</td>
        <td>${escapeHtml(e.actor || '')}</td>
        <td>${e.message ? escapeHtml(e.message) : ''}</td>
      </tr>`
    )
    .join('');
  return `
    <table>
      <thead><tr><th>Time (UTC)</th><th>Action</th><th>Result</th><th>By</th><th>Detail</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function vmDetailPage({ vm, status, info = null, history = [], username = '', error = '', lang = 'en' } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';

  const body = `
    <p><a href="/dashboard">&larr; Back to dashboard</a></p>

    <div class="card" data-vm-uuid="${escapeHtml(vm.uuid)}">
      <h1>${escapeHtml(vm.displayName)} ${stateBadge(status.state)}</h1>
      ${errorHtml}
      <p><code>${escapeHtml(vm.vboxUuid)}</code></p>
      ${actionButtons(status)}
      <p class="muted" data-role="poll-status"></p>
      <div style="margin-top:1rem">
        <a href="/vms/${encodeURIComponent(vm.uuid)}/edit"><button type="button" class="btn-sm">Edit settings</button></a>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/delete" style="display:inline"
              onsubmit="return confirm('Permanently DELETE this VM and its files from VirtualBox? This cannot be undone.');">
          <button type="submit" class="btn-sm danger">Delete VM</button>
        </form>
      </div>
    </div>

    ${screenshotBlock(vm, status)}

    <div class="card">
      <h2>Settings</h2>
      ${allSettingsTable(info)}
    </div>

    <div class="card">
      <h2>Recent activity</h2>
      ${historyTable(history)}
    </div>

    <script src="/public/detail.js" defer></script>`;

  return layout({ title: `${vm.displayName}`, body, showNav: true, username, lang });
}

module.exports = { vmDetailPage };
