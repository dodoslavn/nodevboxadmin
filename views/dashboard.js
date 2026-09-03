'use strict';

const { layout, escapeHtml } = require('./layout');
const i18n = require('../lib/i18n');

// Dashboard: lists ALL VirtualBox VMs with live status. The initial server
// render includes current status; public/app.js then polls /api/vms/status to
// keep the table fresh without a full page reload.
//
// VMs are keyed by their VirtualBox UUID (data-vm-uuid).

function stateBadge(state) {
  const cls =
    state === 'running' ? 'badge-running'
    : state === 'stopped' ? 'badge-stopped'
    : 'badge-unknown';
  return `<span class="badge ${cls}" data-role="state">${escapeHtml(state)}</span>`;
}

function actionButtons(vm, lang) {
  const startDisabled = vm.running ? 'disabled' : '';
  const stopDisabled = vm.running ? '' : 'disabled';
  return `
    <div class="actions" data-role="actions">
      <button type="button" class="btn-sm" data-action="start" ${startDisabled}>${escapeHtml(i18n.t(lang, 'common.start'))}</button>
      <button type="button" class="btn-sm btn-warn" data-action="stop" ${stopDisabled}>${escapeHtml(i18n.t(lang, 'common.stop'))}</button>
    </div>`;
}

function vmRows(vms, emptyMessage, lang) {
  if (!vms.length) return `<tr><td colspan="4"><em>${escapeHtml(emptyMessage)}</em></td></tr>`;
  return vms
    .map(
      (vm) => `
    <tr data-vm-uuid="${escapeHtml(vm.uuid)}">
      <td><a href="/vms/${encodeURIComponent(vm.uuid)}">${escapeHtml(vm.name)}</a></td>
      <td>${stateBadge(vm.state)}</td>
      <td>${actionButtons(vm, lang)}</td>
      <td><code>${escapeHtml(vm.uuid)}</code></td>
    </tr>`
    )
    .join('');
}

function dashboardPage({ vms = [], username = '', vboxError = '', lang = 'en' } = {}) {
  const errorHtml = vboxError ? `<p class="error">${escapeHtml(vboxError)}</p>` : '';
  const regularVms = vms.filter((vm) => !vm.isTemplate);
  const templateVms = vms.filter((vm) => vm.isTemplate);
  const t = (key, vars) => i18n.t(lang, key, vars);
  const colHeaders = `<tr><th>${escapeHtml(t('common.name'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.actions'))}</th><th>${escapeHtml(t('dashboard.colUuid'))}</th></tr>`;

  const body = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>${escapeHtml(t('dashboard.title'))}</h1>
        <a href="/vms/new"><button type="button">${escapeHtml(t('dashboard.createVmBtn'))}</button></a>
      </div>
      ${errorHtml}
      <p class="muted" data-role="poll-status"
         data-i18n-confirm-stop="${escapeHtml(t('dashboard.confirmAcpiStop'))}"
         data-i18n-starting="${escapeHtml(t('dashboard.starting'))}"
         data-i18n-stopping="${escapeHtml(t('dashboard.stopping'))}"
         data-i18n-start-requested="${escapeHtml(t('dashboard.startRequested'))}"
         data-i18n-stop-requested="${escapeHtml(t('dashboard.stopRequested'))}"
         data-i18n-action-failed="${escapeHtml(t('dashboard.actionFailed'))}"
         data-i18n-unknown-error="${escapeHtml(t('dashboard.unknownError'))}"
         data-i18n-network-error="${escapeHtml(t('dashboard.networkError'))}"
         data-i18n-live-status="${escapeHtml(t('dashboard.liveStatus'))}"
         data-i18n-live-status-updated="${escapeHtml(t('dashboard.liveStatusUpdated'))}"
         data-i18n-could-not-refresh="${escapeHtml(t('dashboard.couldNotRefresh'))}"
      >${escapeHtml(t('dashboard.liveStatus'))}</p>
      <table class="vm-table">
        <thead>${colHeaders}</thead>
        <tbody>${vmRows(regularVms, t('dashboard.empty'), lang)}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>${escapeHtml(t('dashboard.templatesTitle'))}</h2>
      <p class="muted">${t('dashboard.templatesDesc', { link: `<a href="/vms/new">${escapeHtml(t('nav.createVm'))}</a>` })}</p>
      <table class="vm-table">
        <thead>${colHeaders}</thead>
        <tbody>${vmRows(templateVms, t('dashboard.templatesEmpty'), lang)}</tbody>
      </table>
    </div>
    <script src="/public/app.js" defer></script>`;

  return layout({ title: t('dashboard.title'), body, showNav: true, username, lang });
}

module.exports = { dashboardPage };
