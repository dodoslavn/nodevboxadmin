'use strict';

const { layout, escapeHtml, PRODUCT_NAME, REPO_URL, VERSION } = require('./layout');
const i18n = require('../lib/i18n');

// MB -> human string. VBox reports memory in whole MB; show GiB once it's
// large enough to be worth it, otherwise plain MB.
function formatMiB(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
  return `${mb} MiB`;
}

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

function moduleRows(modules, checkable, t) {
  return modules
    .map((m) => {
      let statusHtml;
      if (!checkable) {
        statusHtml = `<span class="badge badge-unknown">${escapeHtml(t('host.unknown'))}</span>`;
      } else if (m.conflict) {
        // Conflict module (KVM): loaded is BAD (red), not loaded is good (green).
        statusHtml = m.loaded
          ? `<span class="badge badge-missing">${escapeHtml(t('host.loaded'))}</span>`
          : `<span class="badge badge-running">${escapeHtml(t('host.notLoaded'))}</span>`;
      } else if (m.loaded) {
        statusHtml = `<span class="badge badge-running">${escapeHtml(t('host.loaded'))}</span>`;
      } else if (m.required) {
        statusHtml = `<span class="badge badge-missing">${escapeHtml(t('host.notLoaded'))}</span>`;
      } else {
        statusHtml = `<span class="badge badge-stopped">${escapeHtml(t('host.notLoaded'))}</span>`;
      }
      const tag = m.required ? ` <span class="muted">(${escapeHtml(t('host.required'))})</span>` : '';
      return `
      <tr>
        <td><code>${escapeHtml(m.name)}</code></td>
        <td>${escapeHtml(m.purpose)}${tag}</td>
        <td>${statusHtml}</td>
      </tr>`;
    })
    .join('');
}

function hostPage({ info, resources = { available: false }, username = '', lang = 'en' }) {
  const {
    now, timezone, uptimeSeconds, hostname, runningAs, platform, kernelRelease, arch,
    osPrettyName, vboxVersion, modules, modulesCheckable, requiredMissing,
    kvmLoaded, kvmModules,
  } = info;
  const t = (key, vars) => i18n.t(lang, key, vars);

  const vboxVersionHtml = vboxVersion
    ? `<code>${escapeHtml(vboxVersion)}</code>`
    : `<span class="error">${escapeHtml(t('host.vboxUnreachable'))}</span>`;

  const kvmModList = (kvmModules || []).join(', ');
  const requiredMissingBanner = requiredMissing
    ? `<p class="error">${t('host.requiredMissingBanner')}</p>`
    : '';
  // KVM holds VT-x/AMD-V when loaded, blocking every VM start - keep the loud
  // banner (the per-module status now also shows in the kernel-modules table).
  const kvmConflictBanner = kvmLoaded
    ? `<p class="error">${t('host.kvmConflictBanner', { modules: escapeHtml(kvmModList) })}</p>`
    : '';

  // "running / all registered" totals, e.g. "10 / 12 vCPUs". hostCores/hostMemMB
  // shown as muted context below each.
  const resourcesHtml = resources.available
    ? `
      <table class="kv">
        <tr>
          <th>${escapeHtml(t('host.resVcpus'))}</th>
          <td>${resources.runCpus} / ${resources.allCpus} vCPU
            <span class="muted">(${escapeHtml(t('host.resRunningAllHint', { count: resources.totalCount }))}; ${escapeHtml(t('host.resHost'))} ${resources.hostCores})</span></td>
        </tr>
        <tr>
          <th>${escapeHtml(t('host.memoryLabel'))}</th>
          <td>${escapeHtml(formatMiB(resources.runMemMB))} / ${escapeHtml(formatMiB(resources.allMemMB))}
            <span class="muted">(${escapeHtml(t('host.resRunningAllHint', { count: resources.totalCount }))}; ${escapeHtml(t('host.resHost'))} ${escapeHtml(formatMiB(resources.hostMemMB))})</span></td>
        </tr>
      </table>`
    : `<p class="muted">${escapeHtml(t('host.resUnreadable'))}</p>`;

  const body = `
    <div class="card">
      <h1>${escapeHtml(t('host.title'))}</h1>
      <p class="muted">${escapeHtml(t('host.subtitle'))}</p>
      ${requiredMissingBanner}
      ${kvmConflictBanner}

      <table class="kv">
        <tr><th>${escapeHtml(t('host.software'))}</th><td><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(PRODUCT_NAME)}</a> <span class="muted">v${escapeHtml(VERSION)}</span> <span class="muted">(${escapeHtml(REPO_URL.replace('https://', ''))})</span></td></tr>
        <tr><th>${escapeHtml(t('host.hostname'))}</th><td>${escapeHtml(hostname)}</td></tr>
        <tr><th>${escapeHtml(t('host.runningAs'))}</th><td><code>${escapeHtml(runningAs)}</code> <span class="muted">(${escapeHtml(t('host.runningAsHelp'))})</span></td></tr>
        <tr><th>${escapeHtml(t('host.currentTime'))}</th><td>${escapeHtml(now.toISOString())} <span class="muted">(${escapeHtml(timezone)})</span></td></tr>
        <tr><th>${escapeHtml(t('host.uptime'))}</th><td>${escapeHtml(formatDuration(uptimeSeconds))}</td></tr>
        <tr><th>${escapeHtml(t('host.os'))}</th><td>${escapeHtml(osPrettyName || platform)}</td></tr>
        <tr><th>${escapeHtml(t('host.kernel'))}</th><td>${escapeHtml(kernelRelease)} (${escapeHtml(arch)})</td></tr>
        <tr><th>VirtualBox</th><td>${vboxVersionHtml}</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>${escapeHtml(t('host.resourcesTitle'))}</h2>
      ${resourcesHtml}
    </div>

    <div class="card">
      <h2>${escapeHtml(t('host.modulesTitle'))}</h2>
      ${!modulesCheckable ? `<p class="muted">${escapeHtml(t('host.modulesUnreadable'))}</p>` : ''}
      <table>
        <thead><tr><th>${escapeHtml(t('host.colModule'))}</th><th>${escapeHtml(t('host.colPurpose'))}</th><th>${escapeHtml(t('common.status'))}</th></tr></thead>
        <tbody>${moduleRows(modules, modulesCheckable, t)}</tbody>
      </table>
    </div>`;

  return layout({ title: t('host.title'), body, showNav: true, username, lang });
}

module.exports = { hostPage };
