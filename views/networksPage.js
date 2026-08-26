'use strict';

const { layout, escapeHtml } = require('./layout');

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

function natNetworkRows(nets) {
  if (!nets.length) return '<tr><td colspan="6"><em>No NAT networks yet.</em></td></tr>';
  return nets
    .map(
      (n) => `
      <tr>
        <td>${escapeHtml(n.Name || '')}</td>
        <td>${escapeHtml(n.Network || '')}</td>
        <td>${escapeHtml(n.Gateway || '')}</td>
        <td>${n['DHCP Server'] === 'Yes' ? 'Yes' : 'No'}</td>
        <td>${n.IPv6 === 'Yes' ? 'Yes' : 'No'}</td>
        <td>
          <form method="POST" action="/networks/natnet/${encodeURIComponent(n.Name)}/remove" style="display:inline"
                data-confirm-remove-network="NAT network &quot;${escapeHtml(n.Name)}&quot;">
            <button type="submit" class="btn-sm danger">Remove</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function dhcpControlsHtml(iface, dhcp) {
  if (dhcp) {
    return `
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/dhcp/remove" style="display:inline"
            data-confirm-remove-network="the DHCP server on &quot;${escapeHtml(iface.Name)}&quot;">
        <button type="submit" class="btn-sm btn-warn">Disable DHCP</button>
      </form>`;
  }
  const d = suggestDhcpDefaults(iface.IPAddress);
  return `
    <details style="margin-top:0.3rem">
      <summary class="muted" style="cursor:pointer;font-size:0.85rem">Enable DHCP&hellip;</summary>
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/dhcp/enable" style="margin-top:0.5rem;min-width:220px">
        <div class="field"><label>Server IP</label><input type="text" name="serverIp" value="${escapeHtml(d.serverIp)}" placeholder="192.168.56.100"></div>
        <div class="field"><label>Netmask</label><input type="text" name="netmask" value="255.255.255.0" placeholder="255.255.255.0"></div>
        <div class="field"><label>Lower IP</label><input type="text" name="lowerIp" value="${escapeHtml(d.lowerIp)}" placeholder="192.168.56.101"></div>
        <div class="field"><label>Upper IP</label><input type="text" name="upperIp" value="${escapeHtml(d.upperIp)}" placeholder="192.168.56.254"></div>
        <button type="submit" class="btn-sm">Enable DHCP</button>
      </form>
    </details>`;
}

function ipConfigFormHtml(iface) {
  return `
    <details style="margin-top:0.3rem">
      <summary class="muted" style="cursor:pointer;font-size:0.85rem">Change IP&hellip;</summary>
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/ipconfig" style="margin-top:0.5rem;min-width:220px">
        <div class="field"><label>IP address</label><input type="text" name="ip" value="${escapeHtml(iface.IPAddress || '')}" placeholder="192.168.56.1"></div>
        <div class="field"><label>Netmask</label><input type="text" name="netmask" value="${escapeHtml(iface.NetworkMask || '')}" placeholder="255.255.255.0"></div>
        <button type="submit" class="btn-sm">Update IP</button>
      </form>
      <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/ipconfig/dhcp" style="margin-top:0.5rem">
        <button type="submit" class="btn-sm">Set to automatic (DHCP client)</button>
        <span class="field-help">No static IP - this adapter gets its address from a DHCP server already on that network (e.g. one you run yourself, not VirtualBox's).</span>
      </form>
    </details>`;
}

function hostOnlyRows(ifaces, dhcpByInterface) {
  if (!ifaces.length) return '<tr><td colspan="5"><em>No host-only interfaces yet.</em></td></tr>';
  return ifaces
    .map((iface) => {
      const dhcp = dhcpByInterface[iface.Name];
      return `
      <tr>
        <td>${escapeHtml(iface.Name || '')}</td>
        <td>${escapeHtml(iface.IPAddress || '')} / ${escapeHtml(iface.NetworkMask || '')}</td>
        <td>${escapeHtml(iface.Status || '')}</td>
        <td>${dhcp ? 'Enabled' : 'Disabled'}${dhcpControlsHtml(iface, dhcp)}</td>
        <td>
          ${ipConfigFormHtml(iface)}
          <form method="POST" action="/networks/hostonly/${encodeURIComponent(iface.Name)}/remove" style="display:inline"
                data-confirm-remove-network="host-only interface &quot;${escapeHtml(iface.Name)}&quot;">
            <button type="submit" class="btn-sm danger">Remove</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');
}

function bridgedRows(ifaces) {
  if (!ifaces.length) return '<tr><td colspan="3"><em>No bridgeable interfaces detected.</em></td></tr>';
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

function internalNetRows(names) {
  if (!names.length) return '<tr><td><em>No internal networks currently in use by any VM.</em></td></tr>';
  return names.map((n) => `<tr><td>${escapeHtml(n)}</td></tr>`).join('');
}

function networksConfHtml(networksConf) {
  const conf = networksConf || { path: '/etc/vbox/networks.conf', exists: false, lines: [] };
  if (conf.error) {
    return `<p class="error">Could not read ${escapeHtml(conf.path)}: ${escapeHtml(conf.error)}</p>`;
  }
  if (!conf.exists) {
    return `<p class="muted">No ${escapeHtml(conf.path)} - only VirtualBox's built-in default range is allowed: <code>192.168.56.0/21</code> (and its IPv6 equivalent). An IP outside the allowed range fails with a misleading "permission denied". Create that file (each line: <code>* &lt;CIDR&gt; ...</code>) to allow other subnets.</p>`;
  }
  if (!conf.lines.length) {
    return `<p class="muted">${escapeHtml(conf.path)} exists but has no rules - nothing outside VirtualBox's default range (<code>192.168.56.0/21</code>) is allowed.</p>`;
  }
  const rows = conf.lines.map((l) => `<tr><td><code>${escapeHtml(l)}</code></td></tr>`).join('');
  return `
    <p class="muted">From ${escapeHtml(conf.path)} - an IP outside these ranges fails with a misleading "permission denied" when you try to set it below.</p>
    <table><tbody>${rows}</tbody></table>`;
}

function networksPage({
  natNetworks = [], hostOnlyIfs = [], dhcpByInterface = {}, bridgedIfs = [], internalNets = [], networksConf = null,
  username = '', error = '', notice = '',
} = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';

  const body = `
    <div class="card">
      <h1>Networks</h1>
      <p class="muted">Host-wide networks any VM can attach to. To pick which network a specific VM's adapter uses, edit that VM's Network tab.</p>
      ${errorHtml}
      ${noticeHtml}
    </div>

    <div class="card">
      <h2>NAT Networks</h2>
      <table>
        <thead><tr><th>Name</th><th>Network</th><th>Gateway</th><th>DHCP</th><th>IPv6</th><th></th></tr></thead>
        <tbody>${natNetworkRows(natNetworks)}</tbody>
      </table>
      <h3 style="font-size:1rem">Add a NAT network</h3>
      <form method="POST" action="/networks/natnet/create">
        <div class="grid">
          <div class="field"><label>Name</label><input type="text" name="name" maxlength="64" required placeholder="e.g. NatNetwork"></div>
          <div class="field"><label>Network (CIDR)</label><input type="text" name="network" required placeholder="10.0.2.0/24"></div>
        </div>
        <div class="field field-toggle"><label><input type="checkbox" name="dhcp" value="on" checked> Enable DHCP</label></div>
        <button type="submit">Add NAT network</button>
      </form>
    </div>

    <div class="card">
      <h2>Allowed host-only/NAT subnets</h2>
      ${networksConfHtml(networksConf)}
    </div>

    <div class="card">
      <h2>Host-only Interfaces</h2>
      <table>
        <thead><tr><th>Name</th><th>IP / Netmask</th><th>Status</th><th>DHCP</th><th></th></tr></thead>
        <tbody>${hostOnlyRows(hostOnlyIfs, dhcpByInterface)}</tbody>
      </table>
      <form method="POST" action="/networks/hostonly/create" style="margin-top:0.8rem">
        <button type="submit">Create host-only interface</button>
      </form>
    </div>

    <div class="card">
      <h2>Bridged Interfaces <span class="muted" style="font-weight:400">(the host's own NICs - read-only)</span></h2>
      <table>
        <thead><tr><th>Name</th><th>IP Address</th><th>Status</th></tr></thead>
        <tbody>${bridgedRows(bridgedIfs)}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Internal Networks <span class="muted" style="font-weight:400">(named on a VM's NIC - read-only)</span></h2>
      <table>
        <thead><tr><th>Name</th></tr></thead>
        <tbody>${internalNetRows(internalNets)}</tbody>
      </table>
    </div>

    <script src="/public/networks.js" defer></script>`;

  return layout({ title: 'Networks', body, showNav: true, username });
}

module.exports = { networksPage };
