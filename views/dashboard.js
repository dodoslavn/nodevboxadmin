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

function dashboardPage({ vms = [], username = '', vboxError = '' } = {}) {
  const errorHtml = vboxError ? `<p class="error">${escapeHtml(vboxError)}</p>` : '';

  const rows = vms.length
    ? vms
        .map(
          (vm) => `
        <tr data-vm-uuid="${escapeHtml(vm.uuid)}">
          <td><a href="/vms/${encodeURIComponent(vm.uuid)}">${escapeHtml(vm.name)}</a></td>
          <td>${stateBadge(vm.state)}</td>
          <td>${actionButtons(vm)}</td>
          <td><code>${escapeHtml(vm.uuid)}</code></td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="4"><em>No virtual machines yet. Click "Create VM" to make one.</em></td></tr>';

  const body = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Virtual machines</h1>
        <a href="/vms/new"><button type="button">+ Create VM</button></a>
      </div>
      ${errorHtml}
      <p class="muted" data-role="poll-status">Live status &mdash; updates automatically.</p>
      <table id="vm-table">
        <thead>
          <tr><th>Name</th><th>Status</th><th>Actions</th><th>VirtualBox UUID</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <script src="/public/app.js" defer></script>`;

  return layout({ title: 'Dashboard — nodevboxadmin', body, showNav: true, username });
}

module.exports = { dashboardPage };
