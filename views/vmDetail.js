'use strict';

const { layout, escapeHtml } = require('./layout');
const i18n = require('../lib/i18n');

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
function allSettingsTable(info, tr) {
  if (!info) return `<p class="muted">${escapeHtml(tr('vmDetail.noVboxInfo'))}</p>`;
  const keys = Object.keys(info).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const rows = keys
    .map((k) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(info[k]))}</td></tr>`)
    .join('');
  return `<table class="kv">${rows}</table>`;
}

function actionButtons(status, tr) {
  if (!status.present) return `<span class="muted">${escapeHtml(tr('vmDetail.notPresent'))}</span>`;
  const startDisabled = status.running ? 'disabled' : '';
  const stopDisabled = status.running ? '' : 'disabled';
  return `
    <div class="actions" data-role="actions">
      <button type="button" class="btn-sm" data-action="start" ${startDisabled}>${escapeHtml(tr('common.start'))}</button>
      <button type="button" class="btn-sm btn-warn" data-action="stop" data-mode="acpi" ${stopDisabled}>${escapeHtml(tr('common.stop'))}</button>
      <button type="button" class="btn-sm danger" data-action="stop" data-mode="hard" ${stopDisabled}>${escapeHtml(tr('vmDetail.forceStop'))}</button>
    </div>`;
}

function screenshotBlock(vm, status, tr) {
  if (!status.present) return '';
  if (!status.running) {
    return `<div class="card"><h2>${escapeHtml(tr('vmDetail.console'))}</h2><p class="muted">${escapeHtml(tr('vmDetail.screenshotWhenRunning'))}</p></div>`;
  }
  const src = `/vms/${encodeURIComponent(vm.uuid)}/screenshot.png`;
  return `
    <div class="card">
      <h2>${escapeHtml(tr('vmDetail.console'))}</h2>
      <img id="vm-screenshot" alt="${escapeHtml(tr('vmDetail.screenshotAlt'))}"
           src="${src}?t=${Date.now()}" style="max-width:100%;border:1px solid #ddd;border-radius:4px">
      <p class="muted">${escapeHtml(tr('vmDetail.screenshotUpdates'))}</p>
    </div>`;
}

function historyTable(history, tr) {
  if (!history.length) return `<p class="muted">${escapeHtml(tr('vmDetail.noActions'))}</p>`;
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
      <thead><tr><th>${escapeHtml(tr('vmDetail.timeUtc'))}</th><th>${escapeHtml(tr('vmDetail.action'))}</th><th>${escapeHtml(tr('vmDetail.result'))}</th><th>${escapeHtml(tr('vmDetail.by'))}</th><th>${escapeHtml(tr('vmDetail.detail'))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function vmDetailPage({ vm, status, info = null, history = [], username = '', error = '', lang = 'en' } = {}) {
  const tr = (key, vars) => i18n.t(lang, key, vars);
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';

  const body = `
    <p><a href="/dashboard">&larr; ${escapeHtml(tr('vmDetail.backToDashboard'))}</a></p>

    <div class="card" data-vm-uuid="${escapeHtml(vm.uuid)}"
         data-i18n-starting="${escapeHtml(tr('vmDetail.starting'))}"
         data-i18n-stopping="${escapeHtml(tr('vmDetail.stopping'))}"
         data-i18n-action-requested="${escapeHtml(tr('vmDetail.actionRequested'))}"
         data-i18n-action-failed="${escapeHtml(tr('vmDetail.actionFailed'))}"
         data-i18n-unknown-error="${escapeHtml(tr('vmDetail.unknownError'))}"
         data-i18n-network-error="${escapeHtml(tr('vmDetail.networkError'))}"
         data-i18n-confirm-acpi="${escapeHtml(tr('vmDetail.confirmAcpiStop'))}"
         data-i18n-confirm-hard="${escapeHtml(tr('vmDetail.confirmForceStop'))}">
      <h1>${escapeHtml(vm.displayName)} ${stateBadge(status.state)}</h1>
      ${errorHtml}
      <p><code>${escapeHtml(vm.vboxUuid)}</code></p>
      ${actionButtons(status, tr)}
      <p class="muted" data-role="poll-status"></p>
      <div style="margin-top:1rem">
        <a href="/vms/${encodeURIComponent(vm.uuid)}/edit"><button type="button" class="btn-sm">${escapeHtml(tr('vmDetail.editSettings'))}</button></a>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/delete" style="display:inline"
              data-confirm-delete-vm="${escapeHtml(tr('vmDetail.confirmDeleteVm'))}">
          <button type="submit" class="btn-sm danger">${escapeHtml(tr('vmDetail.deleteVm'))}</button>
        </form>
      </div>
    </div>

    ${screenshotBlock(vm, status, tr)}

    <div class="card">
      <h2>${escapeHtml(tr('vmDetail.settings'))}</h2>
      ${allSettingsTable(info, tr)}
    </div>

    <div class="card">
      <h2>${escapeHtml(tr('vmDetail.recentActivity'))}</h2>
      ${historyTable(history, tr)}
    </div>

    <script src="/public/detail.js" defer></script>`;

  return layout({ title: `${vm.displayName}`, body, showNav: true, username, lang });
}

module.exports = { vmDetailPage };
