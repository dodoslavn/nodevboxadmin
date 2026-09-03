'use strict';

const { layout, escapeHtml } = require('./layout');
const i18n = require('../lib/i18n');

// Host-wide networking page: NAT Networks and host-only interfaces (both
// full lifecycle - create/remove, matching what this VBoxManage build
// actually supports, see lib/vbox.js), plus read-only info on bridged host
// NICs and internal-network names currently in use. This is NOT the per-VM
// NIC configuration in views/editVm.js's Network tab - that just picks
// which of these a specific VM's adapter attaches to.

// Suggests a DHCP range from a host-only interface's own IP, following
// VirtualBox's own convention (seen on hosts with a pre-existing DHCP
// server): server at .100, range .101-.254 on the same /24.
function suggestDhcpDefaults(ip) {
  const parts = (ip || '').split('.');
  if (parts.length !== 4) return { serverIp: '', lowerIp: '', upperIp: '' };
  const base = parts.slice(0, 3).join('.');
  return { serverIp: `${base}.100`, lowerIp: `${base}.101`, upperIp: `${base}.254` };
}

function natNetworkRows(nets, tr) {
  if (!nets.length) return `<tr><td colspan="6"><em>${escapeHtml(tr('networks.noNatNetworks'))}</em></td></tr>`;
  return nets
    .map(
      (n) => `
      <tr>
        <td>${escapeHtml(n.Name || '')}</td>
        <td>${escapeHtml(n.Network || '')}</td>
        <td>${escapeHtml(n.Gateway || '')}</td>
        <td>${n['DHCP Server'] === 'Yes' ? tr('common.yes') : tr('common.no')}</td>
        <td>${n.IPv6 === 'Yes' ? tr('common.yes') : tr('common.no')}</td>
        <td>
          <form method="POST" action="/networks/natnet/${encodeURIComponent(n.Name)}/remove" style="display:inline"
                data-confirm-remove-network="${escapeHtml(tr('networks.confirmRemoveNat', { name: n.Name }))}">
            <button type="submit" class="btn-sm danger">${escapeHtml(tr('common.remove'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function dhcpControlsHtml(iface, dhcp, tr) {
  if (dhcp) {
    return `
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/dhcp/remove" style="display:inline"
            data-confirm-remove-network="${escapeHtml(tr('networks.confirmRemoveDhcp', { name: iface.Name }))}">
        <button type="submit" class="btn-sm btn-warn">${escapeHtml(tr('networks.disableDhcp'))}</button>
      </form>`;
  }
  const d = suggestDhcpDefaults(iface.IPAddress);
  return `
    <details style="margin-top:0.3rem">
      <summary class="muted" style="cursor:pointer;font-size:0.85rem">${escapeHtml(tr('networks.enableDhcpEllipsis'))}</summary>
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/dhcp/enable" style="margin-top:0.5rem;min-width:220px">
        <div class="field"><label>${escapeHtml(tr('networks.serverIp'))}</label><input type="text" name="serverIp" value="${escapeHtml(d.serverIp)}" placeholder="192.168.56.100"></div>
        <div class="field"><label>${escapeHtml(tr('networks.netmask'))}</label><input type="text" name="netmask" value="255.255.255.0" placeholder="255.255.255.0"></div>
        <div class="field"><label>${escapeHtml(tr('networks.lowerIp'))}</label><input type="text" name="lowerIp" value="${escapeHtml(d.lowerIp)}" placeholder="192.168.56.101"></div>
        <div class="field"><label>${escapeHtml(tr('networks.upperIp'))}</label><input type="text" name="upperIp" value="${escapeHtml(d.upperIp)}" placeholder="192.168.56.254"></div>
        <button type="submit" class="btn-sm">${escapeHtml(tr('networks.enableDhcp'))}</button>
      </form>
    </details>`;
}

function ipConfigFormHtml(iface, tr) {
  return `
    <details style="margin-top:0.3rem">
      <summary class="muted" style="cursor:pointer;font-size:0.85rem">${escapeHtml(tr('networks.changeIpEllipsis'))}</summary>
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/ipconfig" style="margin-top:0.5rem;min-width:220px">
        <div class="field"><label>${escapeHtml(tr('networks.ipAddress'))}</label><input type="text" name="ip" value="${escapeHtml(iface.IPAddress || '')}" placeholder="192.168.56.1"></div>
        <div class="field"><label>${escapeHtml(tr('networks.netmask'))}</label><input type="text" name="netmask" value="${escapeHtml(iface.NetworkMask || '')}" placeholder="255.255.255.0"></div>
        <button type="submit" class="btn-sm">${escapeHtml(tr('networks.updateIp'))}</button>
      </form>
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/ipconfig/dhcp" style="margin-top:0.5rem">
        <button type="submit" class="btn-sm">${escapeHtml(tr('networks.setAutomatic'))}</button>
        <span class="field-help">${escapeHtml(tr('networks.setAutomaticHelp'))}</span>
      </form>
    </details>`;
}

function hostOnlyRows(ifaces, dhcpByInterface, tr) {
  if (!ifaces.length) return `<tr><td colspan="5"><em>${escapeHtml(tr('networks.noHostOnly'))}</em></td></tr>`;
  return ifaces
    .map((iface) => {
      const dhcp = dhcpByInterface[iface.Name];
      return `
      <tr>
        <td>${escapeHtml(iface.Name || '')}</td>
        <td>${escapeHtml(iface.IPAddress || '')} / ${escapeHtml(iface.NetworkMask || '')}</td>
        <td>${escapeHtml(iface.Status || '')}</td>
        <td>${dhcp ? escapeHtml(tr('common.enabled')) : escapeHtml(tr('common.disabled'))}${dhcpControlsHtml(iface, dhcp, tr)}</td>
        <td>
          ${ipConfigFormHtml(iface, tr)}
          <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/remove" style="display:inline"
                data-confirm-remove-network="${escapeHtml(tr('networks.confirmRemoveHostOnly', { name: iface.Name }))}">
            <button type="submit" class="btn-sm danger">${escapeHtml(tr('common.remove'))}</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');
}

function bridgedRows(ifaces, tr) {
  if (!ifaces.length) return `<tr><td colspan="3"><em>${escapeHtml(tr('networks.noBridgeable'))}</em></td></tr>`;
  return ifaces
    .map(
      (i) => `
      <tr>
        <td>${escapeHtml(i.Name || '')}</td>
        <td>${escapeHtml(i.IPAddress || '')}</td>
        <td>${escapeHtml(i.Status || '')}</td>
      </tr>`
    )
    .join('');
}

function internalNetRows(names, tr) {
  if (!names.length) return `<tr><td><em>${escapeHtml(tr('networks.noInternal'))}</em></td></tr>`;
  return names.map((n) => `<tr><td>${escapeHtml(n)}</td></tr>`).join('');
}

function networksConfHtml(networksConf, tr) {
  const conf = networksConf || { path: '/etc/vbox/networks.conf', exists: false, lines: [] };
  if (conf.error) {
    return `<p class="error">${tr('networks.confReadError', { path: escapeHtml(conf.path), error: escapeHtml(conf.error) })}</p>`;
  }
  if (!conf.exists) {
    return `<p class="muted">${tr('networks.confMissing', { path: escapeHtml(conf.path), range: '<code>192.168.56.0/21</code>', ruleFormat: '<code>* &lt;CIDR&gt; ...</code>' })}</p>`;
  }
  if (!conf.lines.length) {
    return `<p class="muted">${tr('networks.confEmpty', { path: escapeHtml(conf.path), range: '<code>192.168.56.0/21</code>' })}</p>`;
  }
  const rows = conf.lines.map((l) => `<tr><td><code>${escapeHtml(l)}</code></td></tr>`).join('');
  return `
    <p class="muted">${tr('networks.confFound', { path: escapeHtml(conf.path) })}</p>
    <table><tbody>${rows}</tbody></table>`;
}

function networksPage({
  natNetworks = [], hostOnlyIfs = [], dhcpByInterface = {}, bridgedIfs = [], internalNets = [], networksConf = null,
  username = '', error = '', notice = '', lang = 'en',
} = {}) {
  const tr = (key, vars) => i18n.t(lang, key, vars);
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';

  const body = `
    <div class="card">
      <h1>${escapeHtml(tr('nav.networks'))}</h1>
      <p class="muted">${escapeHtml(tr('networks.subtitle'))}</p>
      ${errorHtml}
      ${noticeHtml}
    </div>

    <div class="card">
      <h2>${escapeHtml(tr('networks.natNetworksTitle'))}</h2>
      <table>
        <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('networks.network'))}</th><th>${escapeHtml(tr('networks.gateway'))}</th><th>DHCP</th><th>IPv6</th><th></th></tr></thead>
        <tbody>${natNetworkRows(natNetworks, tr)}</tbody>
      </table>
      <h3 style="font-size:1rem">${escapeHtml(tr('networks.addNatNetwork'))}</h3>
      <form method="POST" action="/networks/natnet/create">
        <div class="grid">
          <div class="field"><label>${escapeHtml(tr('common.name'))}</label><input type="text" name="name" maxlength="64" required placeholder="e.g. NatNetwork"></div>
          <div class="field"><label>${escapeHtml(tr('networks.networkCidr'))}</label><input type="text" name="network" required placeholder="10.0.2.0/24"></div>
        </div>
        <div class="field field-toggle"><label><input type="checkbox" name="dhcp" value="on" checked> ${escapeHtml(tr('networks.enableDhcp'))}</label></div>
        <button type="submit">${escapeHtml(tr('networks.addNatNetworkBtn'))}</button>
      </form>
    </div>

    <div class="card">
      <h2>${escapeHtml(tr('networks.allowedSubnetsTitle'))}</h2>
      ${networksConfHtml(networksConf, tr)}
    </div>

    <div class="card">
      <h2>${escapeHtml(tr('networks.hostOnlyTitle'))}</h2>
      <table>
        <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('networks.ipNetmask'))}</th><th>${escapeHtml(tr('common.status'))}</th><th>DHCP</th><th></th></tr></thead>
        <tbody>${hostOnlyRows(hostOnlyIfs, dhcpByInterface, tr)}</tbody>
      </table>
      <form method="POST" action="/networks/hostonly/create" style="margin-top:0.8rem">
        <button type="submit">${escapeHtml(tr('networks.createHostOnlyBtn'))}</button>
      </form>
    </div>

    <div class="card">
      <h2>${escapeHtml(tr('networks.bridgedTitle'))} <span class="muted" style="font-weight:400">(${escapeHtml(tr('networks.bridgedReadOnlyNote'))})</span></h2>
      <table>
        <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('networks.ipAddress'))}</th><th>${escapeHtml(tr('common.status'))}</th></tr></thead>
        <tbody>${bridgedRows(bridgedIfs, tr)}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>${escapeHtml(tr('networks.internalTitle'))} <span class="muted" style="font-weight:400">(${escapeHtml(tr('networks.internalReadOnlyNote'))})</span></h2>
      <table>
        <thead><tr><th>${escapeHtml(tr('common.name'))}</th></tr></thead>
        <tbody>${internalNetRows(internalNets, tr)}</tbody>
      </table>
    </div>

    <script src="/public/networks.js" defer></script>`;

  return layout({ title: tr('nav.networks'), body, showNav: true, username, lang });
}

module.exports = { networksPage };
