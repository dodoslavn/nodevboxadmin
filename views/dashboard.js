'use strict';

const { layout, escapeHtml } = require('./layout');

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

function actionButtons(vm) {
  const startDisabled = vm.running ? 'disabled' : '';
  const stopDisabled = vm.running ? '' : 'disabled';
  return `
    <div class="actions" data-role="actions">
      <button type="button" class="btn-sm" data-action="start" ${startDisabled}>Start</button>
      <button type="button" class="btn-sm btn-warn" data-action="stop" ${stopDisabled}>Stop</button>
    </div>`;
}

function vmRows(vms, emptyMessage) {
  if (!vms.length) return `<tr><td colspan="4"><em>${escapeHtml(emptyMessage)}</em></td></tr>`;
  return vms
    .map(
      (vm) => `
    <tr data-vm-uuid="${escapeHtml(vm.uuid)}">
      <td><a href="/vms/${encodeURIComponent(vm.uuid)}">${escapeHtml(vm.name)}</a></td>
      <td>${stateBadge(vm.state)}</td>
      <td>${actionButtons(vm)}</td>
      <td><code>${escapeHtml(vm.uuid)}</code></td>
    </tr>`
    )
    .join('');
}

function dashboardPage({ vms = [], username = '', vboxError = '', lang = 'en' } = {}) {
  const errorHtml = vboxError ? `<p class="error">${escapeHtml(vboxError)}</p>` : '';
  const regularVms = vms.filter((vm) => !vm.isTemplate);
  const templateVms = vms.filter((vm) => vm.isTemplate);

  const body = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Virtual machines</h1>
        <a href="/vms/new"><button type="button">+ Create VM</button></a>
      </div>
      ${errorHtml}
      <p class="muted" data-role="poll-status">Live status &mdash; updates automatically.</p>
      <table class="vm-table">
        <thead>
          <tr><th>Name</th><th>Status</th><th>Actions</th><th>VirtualBox UUID</th></tr>
        </thead>
        <tbody>${vmRows(regularVms, 'No virtual machines yet. Click "Create VM" to make one.')}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Templates</h2>
      <p class="muted">VMs marked as clone sources on the <a href="/vms/new">Create VM</a> page.</p>
      <table class="vm-table">
        <thead>
          <tr><th>Name</th><th>Status</th><th>Actions</th><th>VirtualBox UUID</th></tr>
        </thead>
        <tbody>${vmRows(templateVms, 'No VMs marked as templates yet.')}</tbody>
      </table>
    </div>
    <script src="/public/app.js" defer></script>`;

  return layout({ title: 'Dashboard', body, showNav: true, username, lang });
}

module.exports = { dashboardPage };
