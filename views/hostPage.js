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

// One resource usage bar: a blue "in use" (running) segment + an orange
// "assigned" (stopped VMs) segment, scaled so both always fit even when the
// VMs overcommit the host, with a marker showing the host's physical capacity.
function resourceBar(label, run, assigned, cap, valueHtml, inUseText, assignedText, tr) {
  const total = run + assigned;
  const scale = Math.max(cap, total, 1);
  const pct = (n) => `${(n / scale) * 100}%`;
  const capPct = `${Math.min((cap / scale) * 100, 100)}%`;
  return `
    <div class="res-row">
      <div class="res-head"><span class="res-label">${escapeHtml(label)}</span><span class="res-val">${valueHtml}</span></div>
      <div class="res-bar" role="img" aria-label="${escapeHtml(inUseText)}; ${escapeHtml(assignedText)}">
        ${run > 0 ? `<div class="res-seg res-seg-run" style="width:${pct(run)}" title="${escapeHtml(inUseText)}"></div>` : ''}
        ${assigned > 0 ? `<div class="res-seg res-seg-assigned" style="width:${pct(assigned)}" title="${escapeHtml(assignedText)}"></div>` : ''}
        <div class="res-cap" style="left:${capPct}" title="${escapeHtml(tr('host.resHost'))}: ${escapeHtml(String(cap))}"></div>
      </div>
    </div>`;
}

function hostPage({ info, resources = { available: false }, username = '', lang = 'en' }) {
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

  // Colored "in use / assigned" bars, scaled to host capacity (shown as a
  // marker). Values read "running / all registered", e.g. "10 / 12 vCPU".
  let resourcesHtml;
  if (resources.available) {
    const r = resources;
    const cpuVal = `${r.runCpus} / ${r.allCpus} vCPU <span class="muted">· ${escapeHtml(t('host.resHost'))} ${r.hostCores}</span>`;
    const memVal = `${escapeHtml(formatMiB(r.runMemMB))} / ${escapeHtml(formatMiB(r.allMemMB))} <span class="muted">· ${escapeHtml(t('host.resHost'))} ${escapeHtml(formatMiB(r.hostMemMB))}</span>`;
    resourcesHtml = `
      ${resourceBar(t('host.resVcpus'), r.runCpus, r.allCpus - r.runCpus, r.hostCores,
        cpuVal, `${t('host.resInUse')}: ${r.runCpus} vCPU`, `${t('host.resAssigned')}: ${r.allCpus - r.runCpus} vCPU`, t)}
      ${resourceBar(t('host.memoryLabel'), r.runMemMB, r.allMemMB - r.runMemMB, r.hostMemMB,
        memVal, `${t('host.resInUse')}: ${formatMiB(r.runMemMB)}`, `${t('host.resAssigned')}: ${formatMiB(r.allMemMB - r.runMemMB)}`, t)}
      <div class="res-legend">
        <span><span class="dot" style="background:#2a78d6"></span>${escapeHtml(t('host.resInUse'))}</span>
        <span><span class="dot" style="background:#eb6834"></span>${escapeHtml(t('host.resAssigned'))}</span>
        <span><span class="cap-key"></span>${escapeHtml(t('host.resHost'))}</span>
      </div>`;
  } else {
    resourcesHtml = `<p class="muted">${escapeHtml(t('host.resUnreadable'))}</p>`;
  }

  const body = `
    <div class="card">
      <h1>${escapeHtml(t('host.title'))}</h1>
      ${requiredMissingBanner}

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
