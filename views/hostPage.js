'use strict';

const { layout, escapeHtml, PRODUCT_NAME, REPO_URL } = require('./layout');

// Host diagnostics page: uptime, current time, OS/kernel version, VBox
// version, and whether VirtualBox's kernel modules are loaded. Read-only -
// no forms, nothing here changes host state.

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function moduleRows(modules, checkable) {
  return modules
    .map((m) => {
      let statusHtml;
      if (!checkable) {
        statusHtml = '<span class="badge badge-unknown">unknown</span>';
      } else if (m.loaded) {
        statusHtml = '<span class="badge badge-running">loaded</span>';
      } else if (m.required) {
        statusHtml = '<span class="badge badge-missing">not loaded</span>';
      } else {
        statusHtml = '<span class="badge badge-stopped">not loaded</span>';
      }
      return `
      <tr>
        <td><code>${escapeHtml(m.name)}</code></td>
        <td>${escapeHtml(m.purpose)}${m.required ? ' <span class="muted">(required)</span>' : ''}</td>
        <td>${statusHtml}</td>
      </tr>`;
    })
    .join('');
}

function hostPage({ info, username = '' }) {
  const {
    now, timezone, uptimeSeconds, hostname, runningAs, platform, kernelRelease, arch,
    osPrettyName, vboxVersion, modules, modulesCheckable, requiredMissing,
  } = info;

  const vboxVersionHtml = vboxVersion
    ? `<code>${escapeHtml(vboxVersion)}</code>`
    : '<span class="error">Could not determine (VBoxManage not reachable)</span>';

  const requiredMissingBanner = requiredMissing
    ? `<p class="error">A required VirtualBox kernel module isn't loaded - starting VMs will likely fail. Try <code>sudo systemctl restart vboxdrv</code> or reinstalling the VirtualBox DKMS package.</p>`
    : '';

  const body = `
    <div class="card">
      <h1>Host status</h1>
      <p class="muted">Read-only diagnostics for the machine this app runs on.</p>
      ${requiredMissingBanner}

      <table class="kv">
        <tr><th>Software</th><td><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(PRODUCT_NAME)}</a> <span class="muted">(${escapeHtml(REPO_URL.replace('https://', ''))})</span></td></tr>
        <tr><th>Hostname</th><td>${escapeHtml(hostname)}</td></tr>
        <tr><th>Running as</th><td><code>${escapeHtml(runningAs)}</code> <span class="muted">(OS user this app's process runs under)</span></td></tr>
        <tr><th>Current time</th><td>${escapeHtml(now.toISOString())} <span class="muted">(${escapeHtml(timezone)})</span></td></tr>
        <tr><th>Uptime</th><td>${escapeHtml(formatDuration(uptimeSeconds))}</td></tr>
        <tr><th>OS</th><td>${escapeHtml(osPrettyName || platform)}</td></tr>
        <tr><th>Kernel</th><td>${escapeHtml(kernelRelease)} (${escapeHtml(arch)})</td></tr>
        <tr><th>VirtualBox</th><td>${vboxVersionHtml}</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>VirtualBox kernel modules</h2>
      ${!modulesCheckable ? '<p class="muted">Could not read /proc/modules on this host.</p>' : ''}
      <table>
        <thead><tr><th>Module</th><th>Purpose</th><th>Status</th></tr></thead>
        <tbody>${moduleRows(modules, modulesCheckable)}</tbody>
      </table>
    </div>`;

  return layout({ title: 'Host status', body, showNav: true, username });
}

module.exports = { hostPage };
