'use strict';

const { layout, escapeHtml, PRODUCT_NAME, REPO_URL } = require('./layout');
const i18n = require('../lib/i18n');

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
      } else if (m.loaded) {
        statusHtml = `<span class="badge badge-running">${escapeHtml(t('host.loaded'))}</span>`;
      } else if (m.required) {
        statusHtml = `<span class="badge badge-missing">${escapeHtml(t('host.notLoaded'))}</span>`;
      } else {
        statusHtml = `<span class="badge badge-stopped">${escapeHtml(t('host.notLoaded'))}</span>`;
      }
      return `
      <tr>
        <td><code>${escapeHtml(m.name)}</code></td>
        <td>${escapeHtml(m.purpose)}${m.required ? ` <span class="muted">(${escapeHtml(t('host.required'))})</span>` : ''}</td>
        <td>${statusHtml}</td>
      </tr>`;
    })
    .join('');
}

function hostPage({ info, username = '', lang = 'en' }) {
  const {
    now, timezone, uptimeSeconds, hostname, runningAs, platform, kernelRelease, arch,
    osPrettyName, vboxVersion, modules, modulesCheckable, requiredMissing,
  } = info;
  const t = (key, vars) => i18n.t(lang, key, vars);

  const vboxVersionHtml = vboxVersion
    ? `<code>${escapeHtml(vboxVersion)}</code>`
    : `<span class="error">${escapeHtml(t('host.vboxUnreachable'))}</span>`;

  const requiredMissingBanner = requiredMissing
    ? `<p class="error">${t('host.requiredMissingBanner')}</p>`
    : '';

  const body = `
    <div class="card">
      <h1>${escapeHtml(t('host.title'))}</h1>
      <p class="muted">${escapeHtml(t('host.subtitle'))}</p>
      ${requiredMissingBanner}

      <table class="kv">
        <tr><th>${escapeHtml(t('host.software'))}</th><td><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(PRODUCT_NAME)}</a> <span class="muted">(${escapeHtml(REPO_URL.replace('https://', ''))})</span></td></tr>
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
