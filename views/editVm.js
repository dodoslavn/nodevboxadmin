'use strict';

const { layout, escapeHtml } = require('./layout');
const { OS_TYPE_GROUPS, OS_TYPE_IDS, OS_TYPE_ID_BY_LABEL } = require('./osTypes');
const i18n = require('../lib/i18n');

// Valid options for select fields. Kept here so the POST handler can validate
// against the same lists (shared via module exports).
const GFX_CONTROLLERS = ['vboxvga', 'vmsvga', 'vboxsvga', 'none'];
const BOOT_DEVICES = ['none', 'floppy', 'dvd', 'disk', 'net'];
const CHIPSETS = ['piix3', 'ich9'];
const FIRMWARES = ['bios', 'efi', 'efi32', 'efi64'];
const MOUSE_TYPES = ['ps2', 'usb', 'usbtablet', 'usbmultitouch', 'usbmtscreenpluspad'];
const KEYBOARD_TYPES = ['ps2', 'usb'];
// Old CPU profiles are for testing guest OSes that probe for specific,
// ancient CPUID signatures - not a typo, this is what VBoxManage offers.
const CPU_PROFILES = ['host', 'Intel 8086', 'Intel 80286', 'Intel 80386'];
const PARAVIRT_PROVIDERS = ['none', 'default', 'legacy', 'minimal', 'hyperv', 'kvm'];
const VRDE_AUTH_TYPES = ['null', 'external', 'guest'];
const AUDIO_DRIVERS = ['default', 'null', 'oss', 'alsa', 'pulse', 'dsound', 'was', 'coreaudio'];
const NIC_ATTACHMENTS = ['none', 'nat', 'bridged', 'intnet', 'hostonly', 'natnetwork'];
const NIC_ATTACHMENT_KEYS = {
  none: 'editVm.nicAttachNone', nat: 'editVm.nicAttachNat', bridged: 'editVm.nicAttachBridged',
  intnet: 'editVm.nicAttachIntnet', hostonly: 'editVm.nicAttachHostonly', natnetwork: 'editVm.nicAttachNatnetwork',
};
const NIC_TYPES = ['Am79C970A', 'Am79C973', '82540EM', '82543GC', '82545EM', 'virtio'];
const NIC_COUNT = 4;
const UART_MODES = ['disconnected', 'server', 'client', 'tcpserver', 'tcpclient', 'file', 'hostdevice'];
const UART_MODE_KEYS = {
  disconnected: 'editVm.uartModeDisconnected', server: 'editVm.uartModeServer', client: 'editVm.uartModeClient',
  tcpserver: 'editVm.uartModeTcpserver', tcpclient: 'editVm.uartModeTcpclient', file: 'editVm.uartModeFile',
  hostdevice: 'editVm.uartModeHostdevice',
};
const UART_TYPES = ['16450', '16550A', '16750'];
const UART_COUNT = 4;
const CLIPBOARD_MODES = ['disabled', 'hosttoguest', 'guesttohost', 'bidirectional'];
const DRAGDROP_MODES = ['disabled', 'hosttoguest', 'guesttohost', 'bidirectional'];

function opt(value, current, label) {
  const sel = String(value) === String(current) ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(label || value)}</option>`;
}

function selectField(id, label, options, current, help) {
  const opts = options.map((o) => opt(o.value, current, o.label)).join('');
  const helpHtml = help ? `<span class="field-help">${escapeHtml(help)}</span>` : '';
  return `
    <div class="field">
      <label for="${id}">${escapeHtml(label)}</label>
      <select id="${id}" name="${id}">${opts}</select>
      ${helpHtml}
    </div>`;
}

// Same as selectField, but for a list of { family, items: [{id, label}] }
// groups rendered as <optgroup> sections - used for the OS type picker,
// which mirrors the real VirtualBox GUI's family-grouped combo box instead
// of a free-text field (see views/osTypes.js).
function groupedSelectField(id, label, groups, current, notSetLabel) {
  const emptyOpt = opt('', current, notSetLabel);
  const groupsHtml = groups
    .map((g) => `<optgroup label="${escapeHtml(g.family)}">${g.items.map((i) => opt(i.id, current, i.label)).join('')}</optgroup>`)
    .join('');
  return `
    <div class="field">
      <label for="${id}">${escapeHtml(label)}</label>
      <select id="${id}" name="${id}">${emptyOpt}${groupsHtml}</select>
    </div>`;
}

function numField(id, label, value, { min, max, help } = {}) {
  const helpHtml = help ? `<span class="field-help">${escapeHtml(help)}</span>` : '';
  return `
    <div class="field">
      <label for="${id}">${escapeHtml(label)}</label>
      <input type="number" id="${id}" name="${id}" value="${escapeHtml(String(value ?? ''))}"
             ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''}>
      ${helpHtml}
    </div>`;
}

function textField(id, label, value, { maxlength, required, placeholder } = {}) {
  return `
    <div class="field">
      <label for="${id}">${escapeHtml(label)}</label>
      <input type="text" id="${id}" name="${id}" value="${escapeHtml(String(value ?? ''))}"
             ${maxlength ? `maxlength="${maxlength}"` : ''} ${required ? 'required' : ''}
             ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}>
    </div>`;
}

function toggleField(id, label, on) {
  return `
    <div class="field field-toggle">
      <label><input type="checkbox" name="${id}" value="on"${on ? ' checked' : ''}> ${escapeHtml(label)}</label>
    </div>`;
}

// One adapter's fields within the Network fieldset. `target` is a single
// text field whose meaning depends on the attachment type (bridged device
// name, internal network name, host-only adapter, or NAT network name) -
// mirrors how the real VBox GUI relabels the same field per attachment.
function nicFields(n, nic, attachOpts, typeOpts, tr) {
  return `
    <div style="border-top:1px solid #eee;padding-top:0.6rem;margin-top:0.6rem">
      <strong>${escapeHtml(tr('editVm.adapterN', { n }))}</strong>
      <div class="grid">
        ${selectField(`nic${n}attachment`, tr('editVm.attachedTo'), attachOpts, nic.attachment)}
        ${selectField(`nic${n}type`, tr('editVm.adapterType'), typeOpts, nic.nictype)}
      </div>
      <div class="grid">
        ${textField(`nic${n}mac`, tr('editVm.macAddress'), nic.macaddress, { maxlength: 12, placeholder: 'auto or 12 hex digits' })}
        ${textField(`nic${n}target`, tr('editVm.networkAdapterName'), nic.target, { maxlength: 64, placeholder: 'e.g. eth0, mynet, NatNetwork' })}
      </div>
      ${toggleField(`nic${n}cable`, tr('editVm.cableConnected'), nic.cableconnected)}
    </div>`;
}

// One serial port's fields. `target` meaning depends on `mode`: pipe path
// (server/client), TCP port (tcpserver), host:port (tcpclient), file path
// (file), or a host device path (hostdevice) - no target for disconnected.
function uartFields(n, port, modeOpts, typeOpts, tr) {
  return `
    <div style="border-top:1px solid #eee;padding-top:0.6rem;margin-top:0.6rem">
      <strong>${escapeHtml(tr('editVm.portN', { n }))}</strong>
      ${toggleField(`uart${n}enabled`, tr('editVm.enableSerialPort'), port.enabled)}
      <div class="grid">
        ${textField(`uart${n}iobase`, tr('editVm.ioBase'), port.iobase, { maxlength: 6, placeholder: '0x3F8' })}
        ${numField(`uart${n}irq`, 'IRQ', port.irq, { min: 0, max: 15 })}
      </div>
      <div class="grid">
        ${selectField(`uart${n}type`, tr('editVm.uartType'), typeOpts, port.uarttype)}
        ${selectField(`uart${n}mode`, tr('editVm.mode'), modeOpts, port.mode)}
      </div>
      ${textField(`uart${n}target`, tr('editVm.pathPortHostPort'), port.target, { maxlength: 128, placeholder: 'e.g. /tmp/com1.pipe, 4321, host:4321, /dev/ttyUSB0' })}
    </div>`;
}

const STORAGE_BUS_LABELS = {
  ide: 'IDE', sata: 'SATA', scsi: 'SCSI', sas: 'SAS', usb: 'USB', pcie: 'NVMe (PCIe)', floppy: 'editVm.floppy',
};

function storageBusLabel(bus, tr) {
  const v = STORAGE_BUS_LABELS[bus] || bus;
  return v.startsWith('editVm.') ? tr(v) : v;
}

function attachmentRows(vm, controller, tr) {
  if (!controller.attachments.length) return `<tr><td colspan="4"><em>${escapeHtml(tr('editVm.noAttachments'))}</em></td></tr>`;
  return controller.attachments
    .map((a) => {
      const hasMedium = a.medium && a.medium !== 'none' && a.medium !== 'emptydrive';
      const deleteBtn = hasMedium
        ? `
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/delete-disk" style="display:inline"
                data-confirm-delete-disk="${escapeHtml(tr('editVm.confirmDeleteDisk', { medium: a.medium }))}">
            <input type="hidden" name="storagectl" value="${escapeHtml(controller.name)}">
            <input type="hidden" name="port" value="${a.port}">
            <input type="hidden" name="device" value="${a.device}">
            <button type="submit" class="btn-sm danger">${escapeHtml(tr('editVm.deleteDisk'))}</button>
          </form>`
        : '';
      return `
      <tr>
        <td>${a.port}</td>
        <td>${a.device}</td>
        <td>${escapeHtml(a.medium)}</td>
        <td>
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/attach" style="display:inline">
            <input type="hidden" name="storagectl" value="${escapeHtml(controller.name)}">
            <input type="hidden" name="port" value="${a.port}">
            <input type="hidden" name="device" value="${a.device}">
            <input type="hidden" name="medium" value="none">
            <button type="submit" class="btn-sm btn-warn">${escapeHtml(tr('disks.detach'))}</button>
          </form>
          ${deleteBtn}
        </td>
      </tr>`;
    })
    .join('');
}

function controllerBlock(vm, controller, busOpts, formatOpts, tr) {
  const maxPort = Math.max(controller.portCount - 1, 0);
  return `
    <div class="card" style="margin:0.8rem 0;padding:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="font-size:1rem;margin:0">${escapeHtml(controller.name)}
          <span class="muted">(${escapeHtml(controller.type)}, ${tr('editVm.nPorts', { n: controller.portCount })})</span></h3>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/controllers/${encodeURIComponent(controller.name)}/remove"
              data-confirm-remove-controller="${escapeHtml(tr('editVm.confirmRemoveController', { name: controller.name }))}">
          <button type="submit" class="btn-sm danger">${escapeHtml(tr('editVm.removeController'))}</button>
        </form>
      </div>
      <table>
        <thead><tr><th>${escapeHtml(tr('editVm.port'))}</th><th>${escapeHtml(tr('editVm.device'))}</th><th>${escapeHtml(tr('editVm.medium'))}</th><th></th></tr></thead>
        <tbody>${attachmentRows(vm, controller, tr)}</tbody>
      </table>
      <details style="margin-top:0.5rem">
        <summary class="muted" style="cursor:pointer">${escapeHtml(tr('editVm.attachMediumEllipsis'))}</summary>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/attach" style="margin-top:0.5rem">
          <input type="hidden" name="storagectl" value="${escapeHtml(controller.name)}">
          <div class="grid">
            <div class="field"><label>${tr('editVm.portRange', { max: maxPort })}</label><input type="number" name="port" min="0" max="${maxPort}" value="0"></div>
            <div class="field"><label>${escapeHtml(tr('editVm.device'))}</label><input type="number" name="device" min="0" max="1" value="0"></div>
          </div>
          <div class="grid">
            <div class="field">
              <label>${escapeHtml(tr('disks.type'))}</label>
              <select name="type">
                <option value="hdd">${escapeHtml(tr('disks.hardDisk'))}</option>
                <option value="dvddrive">${escapeHtml(tr('editVm.opticalDvdIso'))}</option>
                <option value="fdd">${escapeHtml(tr('disks.floppy'))}</option>
              </select>
            </div>
            <div class="field"><label>${escapeHtml(tr('editVm.imagePath'))}</label><input type="text" name="medium" placeholder="/path/to/image.iso"></div>
          </div>
          <button type="submit">${escapeHtml(tr('editVm.attachExistingImage'))}</button>
        </form>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/disks" style="margin-top:0.8rem">
          <input type="hidden" name="storagectl" value="${escapeHtml(controller.name)}">
          <div class="grid">
            <div class="field"><label>${tr('editVm.portRange', { max: maxPort })}</label><input type="number" name="port" min="0" max="${maxPort}" value="0"></div>
            <div class="field"><label>${escapeHtml(tr('editVm.device'))}</label><input type="number" name="device" min="0" max="1" value="0"></div>
          </div>
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('editVm.newDiskName'))}</label><input type="text" name="diskname" maxlength="64" placeholder="e.g. disk1"></div>
            <div class="field"><label>${escapeHtml(tr('disks.sizeMb'))}</label><input type="number" name="sizeMB" min="1" max="2000000" value="20000"></div>
          </div>
          <div class="field"><label>${escapeHtml(tr('disks.format'))}</label><select name="format">${formatOpts}</select></div>
          <button type="submit">${escapeHtml(tr('editVm.createAttachNewDisk'))}</button>
        </form>
      </details>
    </div>`;
}

// Rendered as a <fieldset> alongside the others, but OUTSIDE the main
// settings <form> (see editVmPage below): each storage action is its own
// immediate VBoxManage call with its own <form>, and a <form> can't nest
// inside another <form> - a <fieldset> has no such restriction, so it still
// sits in the same visual box as everything else.
function storageSection(vm, storage, buses, formats, busPortRanges, tr) {
  const busOpts = buses.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(storageBusLabel(b, tr))}</option>`).join('');
  const formatOpts = formats.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  const controllersHtml = storage.length
    ? storage.map((c) => controllerBlock(vm, c, busOpts, formatOpts, tr)).join('')
    : `<p class="muted">${escapeHtml(tr('editVm.noControllersYet'))}</p>`;
  const firstBus = buses[0];
  const firstRange = (busPortRanges && busPortRanges[firstBus]) || { min: 1, max: 30 };

  return `
    <fieldset>
      <legend>${escapeHtml(tr('editVm.storage'))}</legend>
      ${controllersHtml}
      <h3 style="font-size:1rem">${escapeHtml(tr('editVm.addController'))}</h3>
      <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/controllers">
        <div class="grid">
          <div class="field"><label>${escapeHtml(tr('common.name'))}</label><input type="text" name="name" maxlength="32" required placeholder="e.g. SATA"></div>
          <div class="field">
            <label>${escapeHtml(tr('editVm.bus'))}</label>
            <select name="bus" data-controller-bus data-port-ranges='${escapeHtml(JSON.stringify(busPortRanges || {}))}'>${busOpts}</select>
          </div>
        </div>
        <div class="field">
          <label>${escapeHtml(tr('editVm.ports'))}</label>
          <input type="number" name="portCount" data-controller-portcount
                 min="${firstRange.min}" max="${firstRange.max}" value="${firstRange.min}"
                 ${firstRange.min === firstRange.max ? 'disabled' : ''}>
          <span class="field-help" data-controller-port-help
                data-i18n-fixed="${escapeHtml(tr('editVm.portsFixedAt'))}"
                data-i18n-range="${escapeHtml(tr('editVm.portsRange'))}"></span>
        </div>
        <button type="submit">${escapeHtml(tr('editVm.addController'))}</button>
      </form>
    </fieldset>`;
}

function usbFilterRows(vm, filters, tr) {
  if (!filters.length) return `<tr><td colspan="5"><em>${escapeHtml(tr('editVm.noFiltersYet'))}</em></td></tr>`;
  return filters
    .map(
      (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.vendorid)}</td>
        <td>${escapeHtml(f.productid)}</td>
        <td>${f.active ? escapeHtml(tr('common.yes')) : escapeHtml(tr('common.no'))}</td>
        <td>
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/usb/filters/${f.index}/remove" style="display:inline">
            <button type="submit" class="btn-sm btn-warn">${escapeHtml(tr('common.remove'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

// Device filters are add/remove only (no in-place edit - see lib/vbox.js for
// why), so like Storage this lives OUTSIDE the main settings <form>. This
// still shares data-tab-panel="usb" with the controller toggles fieldset
// inside the form below - the tab script shows/hides every element with a
// matching data-tab-panel, however many there are.
function usbFiltersSection(vm, filters, tr) {
  return `
    <div class="tab-panel" data-tab-panel="usb">
      <fieldset>
        <legend>${escapeHtml(tr('editVm.usbDeviceFilters'))}</legend>
        <table>
          <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('editVm.vendorId'))}</th><th>${escapeHtml(tr('editVm.productId'))}</th><th>${escapeHtml(tr('editVm.active'))}</th><th></th></tr></thead>
          <tbody>${usbFilterRows(vm, filters, tr)}</tbody>
        </table>
        <p class="field-help">${escapeHtml(tr('editVm.usbFilterHelp'))}</p>
        <h3 style="font-size:1rem">${escapeHtml(tr('editVm.addFilter'))}</h3>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/usb/filters">
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('common.name'))}</label><input type="text" name="name" maxlength="64" required placeholder="e.g. My USB drive"></div>
            <div class="field">
              <label>${escapeHtml(tr('editVm.action'))}</label>
              <select name="action"><option value="hold">${escapeHtml(tr('editVm.holdAction'))}</option><option value="ignore">${escapeHtml(tr('editVm.ignoreAction'))}</option></select>
            </div>
          </div>
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('editVm.vendorIdHex'))}</label><input type="text" name="vendorid" maxlength="4" placeholder="0781"></div>
            <div class="field"><label>${escapeHtml(tr('editVm.productIdHex'))}</label><input type="text" name="productid" maxlength="4" placeholder="5567"></div>
          </div>
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('editVm.manufacturer'))}</label><input type="text" name="manufacturer" maxlength="64"></div>
            <div class="field"><label>${escapeHtml(tr('editVm.product'))}</label><input type="text" name="product" maxlength="64"></div>
          </div>
          <div class="field"><label>${escapeHtml(tr('editVm.serialNumber'))}</label><input type="text" name="serialnumber" maxlength="64"></div>
          <button type="submit">${escapeHtml(tr('editVm.addFilter'))}</button>
        </form>
      </fieldset>
    </div>`;
}

function natRuleRows(vm, nicIndex, rules, tr) {
  if (!rules.length) return `<tr><td colspan="5"><em>${escapeHtml(tr('editVm.noRulesYet'))}</em></td></tr>`;
  return rules
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.protocol)}</td>
        <td>${escapeHtml(r.hostIp || '*')}:${escapeHtml(r.hostPort)}</td>
        <td>${escapeHtml(r.guestIp || '*')}:${escapeHtml(r.guestPort)}</td>
        <td>
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/nic/${nicIndex}/nat-pf/${encodeURIComponent(r.name)}/delete" style="display:inline">
            <button type="submit" class="btn-sm btn-warn">${escapeHtml(tr('common.delete'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

function natAdapterBlock(vm, nicIndex, rules, tr) {
  return `
    <div style="border-top:1px solid #eee;padding-top:0.6rem;margin-top:0.6rem">
      <strong>${escapeHtml(tr('editVm.adapterN', { n: nicIndex }))}</strong>
      <table>
        <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('editVm.proto'))}</th><th>${escapeHtml(tr('editVm.host'))}</th><th>${escapeHtml(tr('editVm.guest'))}</th><th></th></tr></thead>
        <tbody>${natRuleRows(vm, nicIndex, rules, tr)}</tbody>
      </table>
      <details style="margin-top:0.3rem">
        <summary class="muted" style="cursor:pointer;font-size:0.85rem">${escapeHtml(tr('editVm.addRuleEllipsis'))}</summary>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/nic/${nicIndex}/nat-pf" style="margin-top:0.5rem">
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('common.name'))}</label><input type="text" name="name" maxlength="64" required placeholder="e.g. ssh"></div>
            <div class="field">
              <label>${escapeHtml(tr('editVm.protocol'))}</label>
              <select name="protocol"><option value="tcp">TCP</option><option value="udp">UDP</option></select>
            </div>
          </div>
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('editVm.hostIpBlankAny'))}</label><input type="text" name="hostIp" placeholder="127.0.0.1"></div>
            <div class="field"><label>${escapeHtml(tr('editVm.hostPort'))}</label><input type="number" name="hostPort" min="1" max="65535" required placeholder="2222"></div>
          </div>
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('editVm.guestIpBlankAny'))}</label><input type="text" name="guestIp" placeholder="10.0.2.15"></div>
            <div class="field"><label>${escapeHtml(tr('editVm.guestPort'))}</label><input type="number" name="guestPort" min="1" max="65535" required placeholder="22"></div>
          </div>
          <button type="submit" class="btn-sm">${escapeHtml(tr('editVm.addRule'))}</button>
        </form>
      </details>
    </div>`;
}

// Per-VM NAT port-forwarding rules for each NIC currently attached as plain
// "nat" (see lib/vbox.js getNatRules/addNatRule/deleteNatRule for why these
// need their own raw-text parse rather than going through getVmInfo). Lives
// OUTSIDE the main settings <form>, same reasoning as Storage/USB/Shared
// Folders: must reflect the VM's actual saved NIC attachment, not whatever
// an unsubmitted <select> in the form above currently shows.
function natRulesSection(vm, nics, natRules, tr) {
  const natNics = nics.filter((n) => n.attachment === 'nat');
  const body = natNics.length
    ? natNics.map((n) => natAdapterBlock(vm, n.index, natRules[n.index] || [], tr)).join('')
    : `<p class="muted">${escapeHtml(tr('editVm.noNatAdapters'))}</p>`;
  return `
    <div class="tab-panel" data-tab-panel="network">
      <fieldset>
        <legend>${escapeHtml(tr('editVm.natPortForwarding'))}</legend>
        ${body}
      </fieldset>
    </div>`;
}

function sharedFolderRows(vm, folders, tr) {
  if (!folders.length) return `<tr><td colspan="3"><em>${escapeHtml(tr('editVm.noSharedFoldersYet'))}</em></td></tr>`;
  return folders
    .map(
      (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.hostpath)}</td>
        <td>
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/sharedfolders/${encodeURIComponent(f.name)}/remove" style="display:inline">
            <button type="submit" class="btn-sm btn-warn">${escapeHtml(tr('common.remove'))}</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

// Add/remove only (see lib/vbox.js) - lives OUTSIDE the main settings <form>,
// same reasoning as Storage and USB Device Filters.
function sharedFoldersSection(vm, folders, tr) {
  return `
    <div class="tab-panel" data-tab-panel="sharedfolders">
      <fieldset>
        <legend>${escapeHtml(tr('editVm.sharedFolders'))}</legend>
        <table>
          <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('editVm.hostPath'))}</th><th></th></tr></thead>
          <tbody>${sharedFolderRows(vm, folders, tr)}</tbody>
        </table>
        <p class="field-help">${escapeHtml(tr('editVm.sharedFolderHelp'))}</p>
        <h3 style="font-size:1rem">${escapeHtml(tr('editVm.addSharedFolder'))}</h3>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/sharedfolders">
          <div class="grid">
            <div class="field"><label>${escapeHtml(tr('common.name'))}</label><input type="text" name="name" maxlength="64" required placeholder="e.g. docs"></div>
            <div class="field"><label>${escapeHtml(tr('editVm.hostPath'))}</label><input type="text" name="hostpath" maxlength="255" required placeholder="/home/virtualbox/shared"></div>
          </div>
          <div class="field field-toggle"><label><input type="checkbox" name="readonly" value="on"> ${escapeHtml(tr('editVm.readOnly'))}</label></div>
          <div class="field field-toggle"><label><input type="checkbox" name="automount" value="on" checked> ${escapeHtml(tr('editVm.autoMount'))}</label></div>
          <button type="submit">${escapeHtml(tr('editVm.addSharedFolder'))}</button>
        </form>
      </fieldset>
    </div>`;
}

// `vm` = full parsed settings (see server route). Fields default to '' if unknown.
function editVmPage({ vm, username = '', error = '', notice = '', storage = [], storageBuses = [], diskFormats = [], busPortRanges = {}, natRules = {}, lang = 'en' } = {}) {
  const tr = (key, vars) => i18n.t(lang, key, vars);
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : '';
  const noticeHtml = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '';

  const gfxOpts = GFX_CONTROLLERS.map((c) => ({ value: c, label: c }));
  const bootOpts = BOOT_DEVICES.map((b) => ({ value: b, label: b }));
  const chipsetOpts = CHIPSETS.map((c) => ({ value: c, label: c }));
  const firmwareOpts = FIRMWARES.map((f) => ({ value: f, label: f.toUpperCase() }));
  const mouseOpts = MOUSE_TYPES.map((m) => ({ value: m, label: m }));
  const keyboardOpts = KEYBOARD_TYPES.map((k) => ({ value: k, label: k }));
  const cpuProfileOpts = CPU_PROFILES.map((p) => ({ value: p, label: p }));
  const paravirtOpts = PARAVIRT_PROVIDERS.map((p) => ({ value: p, label: p }));
  const vrdeAuthOpts = VRDE_AUTH_TYPES.map((t) => ({ value: t, label: t }));
  const audioDriverOpts = AUDIO_DRIVERS.map((d) => ({ value: d, label: d }));
  const nicAttachOpts = NIC_ATTACHMENTS.map((a) => ({ value: a, label: tr(NIC_ATTACHMENT_KEYS[a] || a) }));
  const nicTypeOpts = NIC_TYPES.map((t) => ({ value: t, label: t }));
  const nics = vm.nics || [];
  const uartModeOpts = UART_MODES.map((m) => ({ value: m, label: tr(UART_MODE_KEYS[m] || m) }));
  const uartTypeOpts = UART_TYPES.map((t) => ({ value: t, label: t }));
  const uarts = vm.uarts || [];
  const usbFilters = vm.usbFilters || [];
  const sharedFolders = vm.sharedFolders || [];
  const clipboardOpts = CLIPBOARD_MODES.map((m) => ({ value: m, label: m }));
  const dragdropOpts = DRAGDROP_MODES.map((m) => ({ value: m, label: m }));

  const body = `
    <p><a href="/vms/${encodeURIComponent(vm.uuid)}">&larr; ${escapeHtml(tr('editVm.backToVm'))}</a></p>
    <div class="card">
      <h1>${tr('editVm.editTitle', { name: escapeHtml(vm.name) })}</h1>
      <p class="muted">${escapeHtml(tr('editVm.editSubtitle'))}</p>
      ${errorHtml}
      ${noticeHtml}
      <div class="tabs" role="tablist">
        <button type="button" class="tab-btn" data-tab-btn="general">${escapeHtml(tr('editVm.tabGeneral'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="system">${escapeHtml(tr('editVm.tabSystem'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="display">${escapeHtml(tr('editVm.tabDisplay'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="audio">${escapeHtml(tr('editVm.tabAudio'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="network">${escapeHtml(tr('nav.networks'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="serial">${escapeHtml(tr('editVm.tabSerialPorts'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="usb">${escapeHtml(tr('editVm.tabUsb'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="sharedfolders">${escapeHtml(tr('editVm.sharedFolders'))}</button>
        <button type="button" class="tab-btn" data-tab-btn="storage">${escapeHtml(tr('editVm.storage'))}</button>
      </div>

      <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/edit">

        <div class="tab-panel" data-tab-panel="general">
          <fieldset>
            <legend>${escapeHtml(tr('editVm.tabGeneral'))}</legend>
            ${textField('name', tr('common.name'), vm.name, { maxlength: 64, required: true })}
            ${textField('description', tr('editVm.description'), vm.description, { maxlength: 255 })}
            ${groupedSelectField('ostype', tr('editVm.osType'), OS_TYPE_GROUPS, vm.ostype, tr('editVm.notSet'))}
          </fieldset>

          <fieldset>
            <legend>${tr('editVm.clipboardDragdropLegend')}</legend>
            <div class="grid">
              ${selectField('clipboardmode', tr('editVm.sharedClipboard'), clipboardOpts, vm.clipboardmode)}
              ${selectField('draganddrop', tr('editVm.dragAndDrop'), dragdropOpts, vm.draganddrop)}
            </div>
            ${toggleField('clipboardfiletransfers', tr('editVm.enableClipboardFileTransfers'), vm.clipboardfiletransfers)}
          </fieldset>

          <fieldset>
            <legend>${escapeHtml(tr('editVm.snapshots'))}</legend>
            ${textField('snapshotfolder', tr('editVm.snapshotFolder'), vm.snapshotfolder, { maxlength: 255, placeholder: 'default, or an absolute path' })}
          </fieldset>

          <fieldset>
            <legend>${escapeHtml(tr('editVm.autostart'))}</legend>
            <p class="field-help">${tr('editVm.autostartHelp', { code: '<code>VBoxManage setproperty autostartdbpath &lt;path&gt;</code>' })}</p>
            ${toggleField('autostartenabled', tr('editVm.autostartEnabled'), vm.autostartenabled)}
            ${numField('autostartdelay', tr('editVm.delaySeconds'), vm.autostartdelay, { min: 0, max: 3600 })}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="system">
          <fieldset>
            <legend>${escapeHtml(tr('editVm.tabSystem'))}</legend>
            <div class="grid">
              ${numField('memoryMB', tr('editVm.baseMemory'), vm.memoryMB, { min: 4, max: 131072 })}
              ${numField('cpus', tr('editVm.processors'), vm.cpus, { min: 1, max: 64 })}
            </div>
            <div class="grid">
              ${selectField('boot1', tr('editVm.bootOrder1'), bootOpts, vm.boot1)}
              ${selectField('boot2', tr('editVm.bootOrder2'), bootOpts, vm.boot2)}
            </div>
            <div class="grid">
              ${selectField('boot3', tr('editVm.bootOrder3'), bootOpts, vm.boot3)}
              ${selectField('boot4', tr('editVm.bootOrder4'), bootOpts, vm.boot4)}
            </div>
            <div class="grid">
              ${selectField('chipset', tr('editVm.chipset'), chipsetOpts, vm.chipset)}
              ${selectField('firmware', tr('editVm.firmware'), firmwareOpts, vm.firmware)}
            </div>
            <div class="grid">
              ${selectField('mouse', tr('editVm.pointingDevice'), mouseOpts, vm.mouse)}
              ${selectField('keyboard', tr('editVm.keyboard'), keyboardOpts, vm.keyboard)}
            </div>
            ${toggleField('acpi', tr('editVm.enableAcpi'), vm.acpi)}
            ${toggleField('ioapic', tr('editVm.enableIoapic'), vm.ioapic)}
            ${toggleField('pae', tr('editVm.enablePae'), vm.pae)}
            ${toggleField('rtcuseutc', tr('editVm.hwClockUtc'), vm.rtcuseutc)}
          </fieldset>

          <fieldset>
            <legend>${escapeHtml(tr('editVm.processor'))}</legend>
            <div class="grid">
              ${numField('cpuexecutioncap', tr('editVm.executionCap'), vm.cpuexecutioncap, { min: 1, max: 100, help: tr('editVm.executionCapHelp') })}
              ${selectField('cpuprofile', tr('editVm.cpuProfile'), cpuProfileOpts, vm.cpuprofile)}
            </div>
            ${toggleField('nestedhwvirt', tr('editVm.enableNestedHwVirt'), vm.nestedhwvirt)}
          </fieldset>

          <fieldset>
            <legend>${escapeHtml(tr('editVm.acceleration'))}</legend>
            ${toggleField('hwvirtex', tr('editVm.enableHwVirt'), vm.hwvirtex)}
            ${toggleField('nestedpaging', tr('editVm.enableNestedPaging'), vm.nestedpaging)}
            ${toggleField('largepages', tr('editVm.enableLargePages'), vm.largepages)}
            ${selectField('paravirtprovider', tr('editVm.paravirtProvider'), paravirtOpts, vm.paravirtprovider)}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="display">
          <fieldset>
            <legend>${escapeHtml(tr('editVm.tabDisplay'))}</legend>
            <div class="grid">
              ${numField('vram', tr('editVm.videoMemory'), vm.vram, { min: 1, max: 256 })}
              ${selectField('graphicscontroller', tr('editVm.graphicsController'), gfxOpts, vm.graphicscontroller)}
            </div>
            ${numField('monitorcount', tr('editVm.monitorCount'), vm.monitorcount, { min: 1, max: 8 })}
            ${toggleField('accelerate3d', tr('editVm.enable3dAcceleration'), vm.accelerate3d)}
          </fieldset>

          <fieldset>
            <legend>${escapeHtml(tr('editVm.remoteDisplay'))}</legend>
            ${toggleField('vrde', tr('editVm.enableRemoteDisplay'), vm.vrde)}
            <div class="grid">
              ${numField('vrdeport', tr('editVm.port'), vm.vrdeport, { min: 1, max: 65535, help: tr('editVm.vrdePortHelp') })}
              ${selectField('vrdeauthtype', tr('editVm.authentication'), vrdeAuthOpts, vm.vrdeauthtype)}
            </div>
          </fieldset>

          <fieldset>
            <legend>${escapeHtml(tr('editVm.recording'))}</legend>
            ${toggleField('recording', tr('editVm.enableVideoRecording'), vm.recording)}
            <div class="grid">
              ${textField('recordingres', tr('editVm.resolution'), vm.recordingres, { maxlength: 11, placeholder: '1024x768' })}
              ${numField('recordingfps', tr('editVm.frameRate'), vm.recordingfps, { min: 1, max: 60 })}
            </div>
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="audio">
          <fieldset>
            <legend>${escapeHtml(tr('editVm.tabAudio'))}</legend>
            ${toggleField('audioenabled', tr('editVm.enableAudio'), vm.audioenabled)}
            <div class="grid">
              ${selectField('audiodriver', tr('editVm.hostAudioDriver'), audioDriverOpts, vm.audiodriver)}
            </div>
            ${toggleField('audioin', tr('editVm.enableAudioInput'), vm.audioin)}
            ${toggleField('audioout', tr('editVm.enableAudioOutput'), vm.audioout)}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="network">
          <fieldset>
            <legend>${escapeHtml(tr('nav.networks'))}</legend>
            ${nics.map((nic) => nicFields(nic.index, nic, nicAttachOpts, nicTypeOpts, tr)).join('')}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="serial">
          <fieldset>
            <legend>${escapeHtml(tr('editVm.tabSerialPorts'))}</legend>
            ${uarts.map((port) => uartFields(port.index, port, uartModeOpts, uartTypeOpts, tr)).join('')}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="usb">
          <fieldset>
            <legend>${escapeHtml(tr('editVm.usbController'))}</legend>
            ${toggleField('usbohci', tr('editVm.enableUsb11'), vm.usbohci)}
            ${toggleField('usbehci', tr('editVm.enableUsb20'), vm.usbehci)}
            ${toggleField('usbxhci', tr('editVm.enableUsb30'), vm.usbxhci)}
          </fieldset>
        </div>

        <button type="submit" id="save-settings-btn">${escapeHtml(tr('editVm.saveChanges'))}</button>
      </form>

      ${usbFiltersSection(vm, usbFilters, tr)}

      ${sharedFoldersSection(vm, sharedFolders, tr)}

      ${natRulesSection(vm, nics, natRules, tr)}

      <div class="tab-panel" data-tab-panel="storage">
        ${storageSection(vm, storage, storageBuses, diskFormats, busPortRanges, tr)}
      </div>
    </div>

    <script src="/public/editVmTabs.js" defer></script>`;
  return layout({ title: tr('editVm.editTitlePlain', { name: vm.name }), body, showNav: true, username, lang });
}

module.exports = {
  editVmPage,
  GFX_CONTROLLERS,
  BOOT_DEVICES,
  CHIPSETS,
  FIRMWARES,
  MOUSE_TYPES,
  KEYBOARD_TYPES,
  CPU_PROFILES,
  PARAVIRT_PROVIDERS,
  VRDE_AUTH_TYPES,
  AUDIO_DRIVERS,
  NIC_ATTACHMENTS,
  NIC_TYPES,
  NIC_COUNT,
  UART_MODES,
  UART_TYPES,
  UART_COUNT,
  CLIPBOARD_MODES,
  DRAGDROP_MODES,
  OS_TYPE_IDS,
  OS_TYPE_ID_BY_LABEL,
};
