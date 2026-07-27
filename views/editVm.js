'use strict';

const { layout, escapeHtml } = require('./layout');
const { OS_TYPE_GROUPS, OS_TYPE_IDS, OS_TYPE_ID_BY_LABEL } = require('./osTypes');

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
const NIC_ATTACHMENT_LABELS = {
  none: 'Not attached', nat: 'NAT', bridged: 'Bridged Adapter',
  intnet: 'Internal Network', hostonly: 'Host-only Adapter', natnetwork: 'NAT Network',
};
const NIC_TYPES = ['Am79C970A', 'Am79C973', '82540EM', '82543GC', '82545EM', 'virtio'];
const NIC_COUNT = 4;
const UART_MODES = ['disconnected', 'server', 'client', 'tcpserver', 'tcpclient', 'file', 'hostdevice'];
const UART_MODE_LABELS = {
  disconnected: 'Disconnected', server: 'Host pipe (server)', client: 'Host pipe (client)',
  tcpserver: 'TCP server', tcpclient: 'TCP client', file: 'Raw file', hostdevice: 'Host device (e.g. /dev/ttyUSB0)',
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
function groupedSelectField(id, label, groups, current, help) {
  const emptyOpt = opt('', current, '(not set)');
  const groupsHtml = groups
    .map((g) => `<optgroup label="${escapeHtml(g.family)}">${g.items.map((i) => opt(i.id, current, i.label)).join('')}</optgroup>`)
    .join('');
  const helpHtml = help ? `<span class="field-help">${escapeHtml(help)}</span>` : '';
  return `
    <div class="field">
      <label for="${id}">${escapeHtml(label)}</label>
      <select id="${id}" name="${id}">${emptyOpt}${groupsHtml}</select>
      ${helpHtml}
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
function nicFields(n, nic, attachOpts, typeOpts) {
  return `
    <div style="border-top:1px solid #eee;padding-top:0.6rem;margin-top:0.6rem">
      <strong>Adapter ${n}</strong>
      <div class="grid">
        ${selectField(`nic${n}attachment`, 'Attached to', attachOpts, nic.attachment)}
        ${selectField(`nic${n}type`, 'Adapter type', typeOpts, nic.nictype)}
      </div>
      <div class="grid">
        ${textField(`nic${n}mac`, 'MAC address', nic.macaddress, { maxlength: 12, placeholder: 'auto or 12 hex digits' })}
        ${textField(`nic${n}target`, 'Network/adapter name', nic.target, { maxlength: 64, placeholder: 'e.g. eth0, mynet, NatNetwork' })}
      </div>
      ${toggleField(`nic${n}cable`, 'Cable connected', nic.cableconnected)}
    </div>`;
}

// One serial port's fields. `target` meaning depends on `mode`: pipe path
// (server/client), TCP port (tcpserver), host:port (tcpclient), file path
// (file), or a host device path (hostdevice) - no target for disconnected.
function uartFields(n, port, modeOpts, typeOpts) {
  return `
    <div style="border-top:1px solid #eee;padding-top:0.6rem;margin-top:0.6rem">
      <strong>Port ${n}</strong>
      ${toggleField(`uart${n}enabled`, 'Enable serial port', port.enabled)}
      <div class="grid">
        ${textField(`uart${n}iobase`, 'I/O base', port.iobase, { maxlength: 6, placeholder: '0x3F8' })}
        ${numField(`uart${n}irq`, 'IRQ', port.irq, { min: 0, max: 15 })}
      </div>
      <div class="grid">
        ${selectField(`uart${n}type`, 'UART type', typeOpts, port.uarttype)}
        ${selectField(`uart${n}mode`, 'Mode', modeOpts, port.mode)}
      </div>
      ${textField(`uart${n}target`, 'Path / port / host:port', port.target, { maxlength: 128, placeholder: 'e.g. /tmp/com1.pipe, 4321, host:4321, /dev/ttyUSB0' })}
    </div>`;
}

const STORAGE_BUS_LABELS = {
  ide: 'IDE', sata: 'SATA', scsi: 'SCSI', sas: 'SAS', usb: 'USB', pcie: 'NVMe (PCIe)', floppy: 'Floppy',
};

function attachmentRows(vm, controller) {
  if (!controller.attachments.length) return '<tr><td colspan="4"><em>No attachments.</em></td></tr>';
  return controller.attachments
    .map((a) => {
      const hasMedium = a.medium && a.medium !== 'none' && a.medium !== 'emptydrive';
      const deleteBtn = hasMedium
        ? `
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/delete-disk" style="display:inline"
                data-confirm-delete-disk="${escapeHtml(a.medium)}">
            <input type="hidden" name="storagectl" value="${escapeHtml(controller.name)}">
            <input type="hidden" name="port" value="${a.port}">
            <input type="hidden" name="device" value="${a.device}">
            <button type="submit" class="btn-sm danger">Delete disk</button>
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
            <button type="submit" class="btn-sm btn-warn">Detach</button>
          </form>
          ${deleteBtn}
        </td>
      </tr>`;
    })
    .join('');
}

function controllerBlock(vm, controller, busOpts, formatOpts) {
  const maxPort = Math.max(controller.portCount - 1, 0);
  return `
    <div class="card" style="margin:0.8rem 0;padding:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="font-size:1rem;margin:0">${escapeHtml(controller.name)}
          <span class="muted">(${escapeHtml(controller.type)}, ${controller.portCount} ports)</span></h3>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/controllers/${encodeURIComponent(controller.name)}/remove"
              data-confirm-remove-controller="${escapeHtml(controller.name)}">
          <button type="submit" class="btn-sm danger">Remove controller</button>
        </form>
      </div>
      <table>
        <thead><tr><th>Port</th><th>Device</th><th>Medium</th><th></th></tr></thead>
        <tbody>${attachmentRows(vm, controller)}</tbody>
      </table>
      <details style="margin-top:0.5rem">
        <summary class="muted" style="cursor:pointer">Attach a medium&hellip;</summary>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/attach" style="margin-top:0.5rem">
          <input type="hidden" name="storagectl" value="${escapeHtml(controller.name)}">
          <div class="grid">
            <div class="field"><label>Port (0-${maxPort})</label><input type="number" name="port" min="0" max="${maxPort}" value="0"></div>
            <div class="field"><label>Device</label><input type="number" name="device" min="0" max="1" value="0"></div>
          </div>
          <div class="grid">
            <div class="field">
              <label>Type</label>
              <select name="type">
                <option value="hdd">Hard disk</option>
                <option value="dvddrive">Optical (DVD/ISO)</option>
                <option value="fdd">Floppy</option>
              </select>
            </div>
            <div class="field"><label>Image path</label><input type="text" name="medium" placeholder="/path/to/image.iso"></div>
          </div>
          <button type="submit">Attach existing image</button>
        </form>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/disks" style="margin-top:0.8rem">
          <input type="hidden" name="storagectl" value="${escapeHtml(controller.name)}">
          <div class="grid">
            <div class="field"><label>Port (0-${maxPort})</label><input type="number" name="port" min="0" max="${maxPort}" value="0"></div>
            <div class="field"><label>Device</label><input type="number" name="device" min="0" max="1" value="0"></div>
          </div>
          <div class="grid">
            <div class="field"><label>New disk name</label><input type="text" name="diskname" maxlength="64" placeholder="e.g. disk1"></div>
            <div class="field"><label>Size (MB)</label><input type="number" name="sizeMB" min="1" max="2000000" value="20000"></div>
          </div>
          <div class="field"><label>Format</label><select name="format">${formatOpts}</select></div>
          <button type="submit">Create + attach new disk</button>
        </form>
      </details>
    </div>`;
}

// Rendered as a <fieldset> alongside the others, but OUTSIDE the main
// settings <form> (see editVmPage below): each storage action is its own
// immediate VBoxManage call with its own <form>, and a <form> can't nest
// inside another <form> - a <fieldset> has no such restriction, so it still
// sits in the same visual box as everything else.
function storageSection(vm, storage, buses, formats, busPortRanges) {
  const busOpts = buses.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(STORAGE_BUS_LABELS[b] || b)}</option>`).join('');
  const formatOpts = formats.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  const controllersHtml = storage.length
    ? storage.map((c) => controllerBlock(vm, c, busOpts, formatOpts)).join('')
    : '<p class="muted">No storage controllers yet.</p>';
  const firstBus = buses[0];
  const firstRange = (busPortRanges && busPortRanges[firstBus]) || { min: 1, max: 30 };

  return `
    <fieldset>
      <legend>Storage</legend>
      ${controllersHtml}
      <h3 style="font-size:1rem">Add a controller</h3>
      <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/storage/controllers">
        <div class="grid">
          <div class="field"><label>Name</label><input type="text" name="name" maxlength="32" required placeholder="e.g. SATA"></div>
          <div class="field">
            <label>Bus</label>
            <select name="bus" data-controller-bus data-port-ranges='${escapeHtml(JSON.stringify(busPortRanges || {}))}'>${busOpts}</select>
          </div>
        </div>
        <div class="field">
          <label>Ports</label>
          <input type="number" name="portCount" data-controller-portcount
                 min="${firstRange.min}" max="${firstRange.max}" value="${firstRange.min}"
                 ${firstRange.min === firstRange.max ? 'disabled' : ''}>
          <span class="field-help" data-controller-port-help></span>
        </div>
        <button type="submit">Add controller</button>
      </form>
    </fieldset>`;
}

function usbFilterRows(vm, filters) {
  if (!filters.length) return '<tr><td colspan="5"><em>No filters yet.</em></td></tr>';
  return filters
    .map(
      (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.vendorid)}</td>
        <td>${escapeHtml(f.productid)}</td>
        <td>${f.active ? 'yes' : 'no'}</td>
        <td>
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/usb/filters/${f.index}/remove" style="display:inline">
            <button type="submit" class="btn-sm btn-warn">Remove</button>
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
function usbFiltersSection(vm, filters) {
  return `
    <div class="tab-panel" data-tab-panel="usb">
      <fieldset>
        <legend>USB Device Filters</legend>
        <table>
          <thead><tr><th>Name</th><th>Vendor ID</th><th>Product ID</th><th>Active</th><th></th></tr></thead>
          <tbody>${usbFilterRows(vm, filters)}</tbody>
        </table>
        <p class="field-help">Hold/ignore action isn't shown here - VirtualBox doesn't expose it for reading back, only setting.</p>
        <h3 style="font-size:1rem">Add a filter</h3>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/usb/filters">
          <div class="grid">
            <div class="field"><label>Name</label><input type="text" name="name" maxlength="64" required placeholder="e.g. My USB drive"></div>
            <div class="field">
              <label>Action</label>
              <select name="action"><option value="hold">Hold (capture into VM)</option><option value="ignore">Ignore</option></select>
            </div>
          </div>
          <div class="grid">
            <div class="field"><label>Vendor ID (hex)</label><input type="text" name="vendorid" maxlength="4" placeholder="0781"></div>
            <div class="field"><label>Product ID (hex)</label><input type="text" name="productid" maxlength="4" placeholder="5567"></div>
          </div>
          <div class="grid">
            <div class="field"><label>Manufacturer</label><input type="text" name="manufacturer" maxlength="64"></div>
            <div class="field"><label>Product</label><input type="text" name="product" maxlength="64"></div>
          </div>
          <div class="field"><label>Serial number</label><input type="text" name="serialnumber" maxlength="64"></div>
          <button type="submit">Add filter</button>
        </form>
      </fieldset>
    </div>`;
}

function sharedFolderRows(vm, folders) {
  if (!folders.length) return '<tr><td colspan="3"><em>No shared folders yet.</em></td></tr>';
  return folders
    .map(
      (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.hostpath)}</td>
        <td>
          <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/sharedfolders/${encodeURIComponent(f.name)}/remove" style="display:inline">
            <button type="submit" class="btn-sm btn-warn">Remove</button>
          </form>
        </td>
      </tr>`
    )
    .join('');
}

// Add/remove only (see lib/vbox.js) - lives OUTSIDE the main settings <form>,
// same reasoning as Storage and USB Device Filters.
function sharedFoldersSection(vm, folders) {
  return `
    <div class="tab-panel" data-tab-panel="sharedfolders">
      <fieldset>
        <legend>Shared Folders</legend>
        <table>
          <thead><tr><th>Name</th><th>Host path</th><th></th></tr></thead>
          <tbody>${sharedFolderRows(vm, folders)}</tbody>
        </table>
        <p class="field-help">Read-only/auto-mount aren't shown here - VirtualBox doesn't expose them for reading back, only setting.</p>
        <h3 style="font-size:1rem">Add a shared folder</h3>
        <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/sharedfolders">
          <div class="grid">
            <div class="field"><label>Name</label><input type="text" name="name" maxlength="64" required placeholder="e.g. docs"></div>
            <div class="field"><label>Host path</label><input type="text" name="hostpath" maxlength="255" required placeholder="/home/virtualbox/shared"></div>
          </div>
          <div class="field field-toggle"><label><input type="checkbox" name="readonly" value="on"> Read-only</label></div>
          <div class="field field-toggle"><label><input type="checkbox" name="automount" value="on" checked> Auto-mount</label></div>
          <button type="submit">Add shared folder</button>
        </form>
      </fieldset>
    </div>`;
}

// `vm` = full parsed settings (see server route). Fields default to '' if unknown.
function editVmPage({ vm, username = '', error = '', notice = '', storage = [], storageBuses = [], diskFormats = [], busPortRanges = {} } = {}) {
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
  const nicAttachOpts = NIC_ATTACHMENTS.map((a) => ({ value: a, label: NIC_ATTACHMENT_LABELS[a] || a }));
  const nicTypeOpts = NIC_TYPES.map((t) => ({ value: t, label: t }));
  const nics = vm.nics || [];
  const uartModeOpts = UART_MODES.map((m) => ({ value: m, label: UART_MODE_LABELS[m] || m }));
  const uartTypeOpts = UART_TYPES.map((t) => ({ value: t, label: t }));
  const uarts = vm.uarts || [];
  const usbFilters = vm.usbFilters || [];
  const sharedFolders = vm.sharedFolders || [];
  const clipboardOpts = CLIPBOARD_MODES.map((m) => ({ value: m, label: m }));
  const dragdropOpts = DRAGDROP_MODES.map((m) => ({ value: m, label: m }));

  const body = `
    <p><a href="/vms/${encodeURIComponent(vm.uuid)}">&larr; Back to VM</a></p>
    <div class="card">
      <h1>Edit ${escapeHtml(vm.name)}</h1>
      <p class="muted">Change VM settings. The VM should be powered off for changes to apply cleanly.</p>
      ${errorHtml}
      ${noticeHtml}
      <div class="tabs" role="tablist">
        <button type="button" class="tab-btn" data-tab-btn="general">General</button>
        <button type="button" class="tab-btn" data-tab-btn="system">System</button>
        <button type="button" class="tab-btn" data-tab-btn="display">Display</button>
        <button type="button" class="tab-btn" data-tab-btn="audio">Audio</button>
        <button type="button" class="tab-btn" data-tab-btn="network">Network</button>
        <button type="button" class="tab-btn" data-tab-btn="serial">Serial Ports</button>
        <button type="button" class="tab-btn" data-tab-btn="usb">USB</button>
        <button type="button" class="tab-btn" data-tab-btn="sharedfolders">Shared Folders</button>
        <button type="button" class="tab-btn" data-tab-btn="storage">Storage</button>
      </div>

      <form method="POST" action="/vms/${encodeURIComponent(vm.uuid)}/edit">

        <div class="tab-panel" data-tab-panel="general">
          <fieldset>
            <legend>General</legend>
            ${textField('name', 'Name', vm.name, { maxlength: 64, required: true })}
            ${textField('description', 'Description', vm.description, { maxlength: 255 })}
            ${groupedSelectField('ostype', 'OS type', OS_TYPE_GROUPS, vm.ostype)}
          </fieldset>

          <fieldset>
            <legend>Shared Clipboard &amp; Drag'n'Drop</legend>
            <div class="grid">
              ${selectField('clipboardmode', 'Shared clipboard', clipboardOpts, vm.clipboardmode)}
              ${selectField('draganddrop', 'Drag and drop', dragdropOpts, vm.draganddrop)}
            </div>
            ${toggleField('clipboardfiletransfers', 'Enable clipboard file transfers', vm.clipboardfiletransfers)}
          </fieldset>

          <fieldset>
            <legend>Snapshots</legend>
            ${textField('snapshotfolder', 'Snapshot folder', vm.snapshotfolder, { maxlength: 255, placeholder: 'default, or an absolute path' })}
          </fieldset>

          <fieldset>
            <legend>Autostart</legend>
            <p class="field-help">Requires the host's autostart database to be configured
              (<code>VBoxManage setproperty autostartdbpath &lt;path&gt;</code>) - saved separately from
              the rest of this form, so if it fails your other changes are unaffected.</p>
            ${toggleField('autostartenabled', 'Start this VM automatically on host boot', vm.autostartenabled)}
            ${numField('autostartdelay', 'Delay (seconds)', vm.autostartdelay, { min: 0, max: 3600 })}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="system">
          <fieldset>
            <legend>System</legend>
            <div class="grid">
              ${numField('memoryMB', 'Base memory (MB)', vm.memoryMB, { min: 4, max: 131072 })}
              ${numField('cpus', 'Processors', vm.cpus, { min: 1, max: 64 })}
            </div>
            <div class="grid">
              ${selectField('boot1', 'Boot order 1st', bootOpts, vm.boot1)}
              ${selectField('boot2', 'Boot order 2nd', bootOpts, vm.boot2)}
            </div>
            <div class="grid">
              ${selectField('boot3', 'Boot order 3rd', bootOpts, vm.boot3)}
              ${selectField('boot4', 'Boot order 4th', bootOpts, vm.boot4)}
            </div>
            <div class="grid">
              ${selectField('chipset', 'Chipset', chipsetOpts, vm.chipset)}
              ${selectField('firmware', 'Firmware', firmwareOpts, vm.firmware)}
            </div>
            <div class="grid">
              ${selectField('mouse', 'Pointing device', mouseOpts, vm.mouse)}
              ${selectField('keyboard', 'Keyboard', keyboardOpts, vm.keyboard)}
            </div>
            ${toggleField('acpi', 'Enable ACPI', vm.acpi)}
            ${toggleField('ioapic', 'Enable I/O APIC', vm.ioapic)}
            ${toggleField('pae', 'Enable PAE/NX', vm.pae)}
            ${toggleField('rtcuseutc', 'Hardware clock in UTC', vm.rtcuseutc)}
          </fieldset>

          <fieldset>
            <legend>Processor</legend>
            <div class="grid">
              ${numField('cpuexecutioncap', 'Execution cap (%)', vm.cpuexecutioncap, { min: 1, max: 100, help: 'Limits CPU time given to the VM relative to the host.' })}
              ${selectField('cpuprofile', 'CPU profile', cpuProfileOpts, vm.cpuprofile)}
            </div>
            ${toggleField('nestedhwvirt', 'Enable Nested VT-x/AMD-V', vm.nestedhwvirt)}
          </fieldset>

          <fieldset>
            <legend>Acceleration</legend>
            ${toggleField('hwvirtex', 'Enable VT-x/AMD-V', vm.hwvirtex)}
            ${toggleField('nestedpaging', 'Enable Nested Paging', vm.nestedpaging)}
            ${toggleField('largepages', 'Enable Large Pages', vm.largepages)}
            ${selectField('paravirtprovider', 'Paravirtualization provider', paravirtOpts, vm.paravirtprovider)}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="display">
          <fieldset>
            <legend>Display</legend>
            <div class="grid">
              ${numField('vram', 'Video memory (MB)', vm.vram, { min: 1, max: 256 })}
              ${selectField('graphicscontroller', 'Graphics controller', gfxOpts, vm.graphicscontroller)}
            </div>
            ${numField('monitorcount', 'Monitor count', vm.monitorcount, { min: 1, max: 8 })}
            ${toggleField('accelerate3d', 'Enable 3D acceleration', vm.accelerate3d)}
          </fieldset>

          <fieldset>
            <legend>Remote Display (VRDE)</legend>
            ${toggleField('vrde', 'Enable remote display', vm.vrde)}
            <div class="grid">
              ${numField('vrdeport', 'Port', vm.vrdeport, { min: 1, max: 65535, help: 'Default 3389.' })}
              ${selectField('vrdeauthtype', 'Authentication', vrdeAuthOpts, vm.vrdeauthtype)}
            </div>
          </fieldset>

          <fieldset>
            <legend>Recording</legend>
            ${toggleField('recording', 'Enable video recording', vm.recording)}
            <div class="grid">
              ${textField('recordingres', 'Resolution (WxH)', vm.recordingres, { maxlength: 11, placeholder: '1024x768' })}
              ${numField('recordingfps', 'Frame rate (fps)', vm.recordingfps, { min: 1, max: 60 })}
            </div>
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="audio">
          <fieldset>
            <legend>Audio</legend>
            ${toggleField('audioenabled', 'Enable audio', vm.audioenabled)}
            <div class="grid">
              ${selectField('audiodriver', 'Host audio driver', audioDriverOpts, vm.audiodriver)}
            </div>
            ${toggleField('audioin', 'Enable audio input', vm.audioin)}
            ${toggleField('audioout', 'Enable audio output', vm.audioout)}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="network">
          <fieldset>
            <legend>Network</legend>
            ${nics.map((nic) => nicFields(nic.index, nic, nicAttachOpts, nicTypeOpts)).join('')}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="serial">
          <fieldset>
            <legend>Serial Ports</legend>
            ${uarts.map((port) => uartFields(port.index, port, uartModeOpts, uartTypeOpts)).join('')}
          </fieldset>
        </div>

        <div class="tab-panel" data-tab-panel="usb">
          <fieldset>
            <legend>USB Controller</legend>
            ${toggleField('usbohci', 'Enable USB controller (OHCI, USB 1.1)', vm.usbohci)}
            ${toggleField('usbehci', 'Enable USB 2.0 (EHCI)', vm.usbehci)}
            ${toggleField('usbxhci', 'Enable USB 3.0 (xHCI)', vm.usbxhci)}
          </fieldset>
        </div>

        <button type="submit" id="save-settings-btn">Save changes</button>
      </form>

      ${usbFiltersSection(vm, usbFilters)}

      ${sharedFoldersSection(vm, sharedFolders)}

      <div class="tab-panel" data-tab-panel="storage">
        ${storageSection(vm, storage, storageBuses, diskFormats, busPortRanges)}
      </div>
    </div>

    <script src="/public/editVmTabs.js" defer></script>`;
  return layout({ title: `Edit ${vm.name} — nodevboxadmin`, body, showNav: true, username });
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
