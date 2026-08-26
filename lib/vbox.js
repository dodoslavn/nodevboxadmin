'use strict';

const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const config = require('../config/config.json');

// VBoxManage wrapper.
//
// SECURITY: every call goes through runVBoxManage(), which uses execFile with
// an argument ARRAY - never a shell string. This means VM UUIDs and other
// arguments are passed as literal argv entries and cannot be interpreted by a
// shell (no injection possible). We also never accept raw user input here:
// callers pass UUIDs that come from VirtualBox itself (the VM list).
//
// Every call has a timeout so a hung VBoxManage process can't hang a request.

// Custom error type so callers can distinguish failure modes.
class VBoxError extends Error {
  constructor(message, { code = 'VBOX_ERROR', stderr = '', cause = null } = {}) {
    super(message);
    this.name = 'VBoxError';
    this.code = code;
    this.stderr = stderr;
    if (cause) this.cause = cause;
  }
}

// Runs VBoxManage once. Resolves { stdout, stderr } or rejects with a
// VBoxError. Never invokes a shell.
function execVBoxManageOnce(args, { timeoutMs = config.VBOXMANAGE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      config.VBOXMANAGE_BIN,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          // Distinguish common failure modes for better UX/logging.
          if (err.code === 'ENOENT') {
            reject(
              new VBoxError(
                `VBoxManage binary not found ("${config.VBOXMANAGE_BIN}"). Is VirtualBox installed and on PATH?`,
                { code: 'VBOXMANAGE_NOT_FOUND', cause: err }
              )
            );
            return;
          }
          if (err.killed || err.signal === 'SIGTERM') {
            reject(
              new VBoxError(`VBoxManage timed out after ${timeoutMs}ms (args: ${args.join(' ')})`, {
                code: 'VBOXMANAGE_TIMEOUT',
                stderr: String(stderr || ''),
                cause: err,
              })
            );
            return;
          }
          reject(
            new VBoxError(`VBoxManage failed: ${String(stderr || err.message).trim()}`, {
              code: 'VBOXMANAGE_FAILED',
              stderr: String(stderr || ''),
              cause: err,
            })
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

// The VirtualBox COM server (VBoxSVC) runs with --auto-shutdown and stops when
// idle. The next VBoxManage call has to restart it, which occasionally fails
// or races, producing a transient "Failed to create the VirtualBox object" /
// NS_ERROR_FAILURE error. Detect that and retry a couple of times - the first
// (failed) call usually gets the server starting, so the retry succeeds.
//
// E_ACCESSDENIED / "Access denied (extended info not available)" belongs in
// the same bucket - confirmed by testing: `hostonlyif ipconfig` (and, by the
// same mechanism, presumably other host-network calls) intermittently fails
// with this exact error when a second VBoxManage invocation races VBoxSVC
// shortly after another one touched host network interface state (e.g. right
// after `hostonlyif create`, or a concurrent call from elsewhere) - retrying
// the identical command moments later reliably succeeds, and running it
// completely in isolation never reproduces the failure at all. That's the
// signature of a transient COM-layer race, not a real permission problem
// (the OS-level permissions/group membership don't change between calls).
function isTransientComError(err) {
  if (!(err instanceof VBoxError) || err.code !== 'VBOXMANAGE_FAILED') return false;
  const s = String(err.stderr || err.message);
  return (
    /Failed to create the VirtualBox object/i.test(s) ||
    /NS_ERROR_FAILURE/i.test(s) ||
    /COM server is not running or failed to start/i.test(s) ||
    /object is not ready/i.test(s) ||
    /E_ACCESSDENIED/i.test(s) ||
    /Access denied \(extended info not available\)/i.test(s)
  );
}

function isTimeoutError(err) {
  return err instanceof VBoxError && err.code === 'VBOXMANAGE_TIMEOUT';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Public entry point: runs VBoxManage with automatic retry on transient COM
// server errors.
// maxAttempts=5 with 400ms-per-attempt linear backoff gives ~4s of total
// retry window (400+800+1200+1600ms between attempts 1-5). Confirmed by
// testing directly against VBoxSVC.log: right after VBoxSVC (re)starts from
// its idle auto-shutdown, it can fail to spawn its VBoxNetAdpCtl helper
// process (host network interface operations like EnableStaticIpConfig need
// it) for a good ~1.4s+ before it settles - reproduced identically across
// two separate VBoxSVC restarts. The previous 3-attempt/~1.2s window landed
// right at the edge of that and often gave up just before it cleared;
// widening it comfortably outlasts the warm-up hiccup instead of failing a
// user-facing action for a problem that resolves itself a moment later.
//
// The same cold-start condition can also surface as an outright hang rather
// than a fast COM error - confirmed against a real deployment where
// `list hostonlyifs --long` ran in under 100ms manually (VBoxSVC already
// warm) but timed out at 15s through the app (VBoxSVC needing a cold spawn).
// There's no error text to pattern-match in that case (the process produced
// nothing before being killed), so a timeout gets exactly ONE unconditional
// retry, separately budgeted from the fast-failure retries above: by the
// time this retry runs, VBoxSVC has already had a full timeoutMs to finish
// starting, so it should no longer be cold. If it times out again, something
// else is actually wrong - bounding this to one retry caps the worst case at
// 2x timeoutMs instead of letting it compound into a minutes-long hang.
async function runVBoxManage(args, opts = {}) {
  const maxAttempts = 5;
  const maxTimeoutRetries = 1;
  let timeoutRetries = 0;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await execVBoxManageOnce(args, opts);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isTransientComError(err)) {
        await sleep(400 * attempt); // 400, 800, 1200, 1600ms backoff
        continue;
      }
      if (isTimeoutError(err) && timeoutRetries < maxTimeoutRetries) {
        timeoutRetries++;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Parses VBoxManage `--machinereadable` output into a flat key/value object.
// Lines look like:  key="value"   or   key=value   or   "key"="value"
// Storage attachment keys (e.g. "SATA-0-0") are quoted by VBoxManage because
// they embed a user-chosen controller name; both keys and values have their
// surrounding double quotes stripped.
function unquote(s) {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function parseMachineReadable(stdout) {
  const out = {};
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = unquote(line.slice(0, eq));
    const value = unquote(line.slice(eq + 1));
    out[key] = value;
  }
  return out;
}

// Lists all registered VMs. Returns [{ name, uuid }].
// Uses `list vms` output:  "Some VM Name" {uuid}
async function listVms() {
  const { stdout } = await runVBoxManage(['list', 'vms']);
  const vms = [];
  const re = /^"(.*)"\s+\{([0-9a-fA-F-]+)\}\s*$/;
  for (const line of stdout.split(/\r?\n/)) {
    const m = re.exec(line.trim());
    if (m) vms.push({ name: m[1], uuid: m[2] });
  }
  return vms;
}

// Lists UUIDs of currently running VMs (as a Set of lowercased uuids).
async function runningVmUuids() {
  const { stdout } = await runVBoxManage(['list', 'runningvms']);
  const set = new Set();
  const re = /\{([0-9a-fA-F-]+)\}\s*$/;
  for (const line of stdout.split(/\r?\n/)) {
    const m = re.exec(line.trim());
    if (m) set.add(m[1].toLowerCase());
  }
  return set;
}

// Returns parsed machine-readable info for one VM, or throws VBoxError with
// code 'VM_NOT_FOUND' if the VM doesn't exist / is inaccessible.
async function getVmInfo(uuid) {
  try {
    const { stdout } = await runVBoxManage(['showvminfo', uuid, '--machinereadable']);
    return parseMachineReadable(stdout);
  } catch (err) {
    if (err instanceof VBoxError && /could not find|not find a registered/i.test(err.stderr)) {
      throw new VBoxError(`VM not found: ${uuid}`, { code: 'VM_NOT_FOUND', cause: err });
    }
    throw err;
  }
}

// Returns a normalized state summary for a VM:
//   { uuid, name, state, running }
// `state` is VBox's VMState (e.g. "running", "poweroff", "saved", "aborted").
async function getVmStatus(uuid) {
  const info = await getVmInfo(uuid);
  const state = info.VMState || 'unknown';
  return {
    uuid,
    name: info.name || '',
    state,
    running: state === 'running',
  };
}

// Starts a VM headless. Returns { ok, message }.
async function startVm(uuid) {
  const { stdout, stderr } = await runVBoxManage(['startvm', uuid, '--type', 'headless']);
  return { ok: true, message: (stdout || stderr || '').trim() };
}

// Creates a new, empty VM and registers it in VirtualBox. Returns
// { ok, uuid, name }. Applies minimal config (memory, cpus). No disk/OS -
// it's a blank VM the user can configure/install later.
//
// `name` is validated by the caller; VBoxManage receives it as a literal
// argv entry (no shell), so it cannot inject commands.
async function createVm({ name, memoryMB = 2048, cpus = 1 }) {
  // createvm --register prints "UUID: <uuid>" on success.
  const { stdout } = await runVBoxManage(['createvm', '--name', name, '--register']);
  const m = stdout.match(/UUID:\s*(\S+)/);
  const uuid = m ? m[1] : null;
  if (!uuid) {
    throw new VBoxError('VM created but could not determine its UUID.', { code: 'CREATE_NO_UUID' });
  }

  // Best-effort minimal config. If modifyvm fails, the VM still exists;
  // surface the error so the caller can decide.
  await runVBoxManage([
    'modifyvm', uuid,
    '--memory', String(memoryMB),
    '--cpus', String(cpus),
  ]);

  return { ok: true, uuid, name };
}

// Permanently deletes a VM from VirtualBox (unregister + delete its files).
// Destructive - the caller is responsible for confirmation.
async function deleteVm(uuid) {
  await runVBoxManage(['unregistervm', uuid, '--delete']);
  return { ok: true };
}

// Modifies a VM's settings. Only provided fields are changed. The VM must be
// powered off for most changes to apply. All values are passed to VBoxManage
// as literal argv entries (no shell). Recognized fields:
//   name, description, ostype, memoryMB, cpus, vram, graphicscontroller,
//   boot1, boot2, boot3, boot4, chipset, firmware, mouse, keyboard,
//   acpi, ioapic, pae, rtcuseutc, cpuexecutioncap, cpuprofile, nestedhwvirt,
//   hwvirtex, nestedpaging, largepages, paravirtprovider, monitorcount,
//   accelerate3d, vrde, vrdeport, vrdeauthtype, recording, recordingres,
//   recordingfps, audioenabled, audiodriver, audioin, audioout,
//   clipboardmode, clipboardfiletransfers, draganddrop, snapshotfolder
//   (booleans expect 'on'/'off', EXCEPT clipboardfiletransfers which is
//   VBoxManage's own odd-one-out: it takes 'enabled'/'disabled' as a value,
//   not 'on'/'off' - confirmed by testing, caller must pass that spelling)
async function modifyVm(uuid, fields = {}) {
  const args = ['modifyvm', uuid];
  const map = {
    name: '--name',
    description: '--description',
    ostype: '--ostype',
    memoryMB: '--memory',
    cpus: '--cpus',
    vram: '--vram',
    graphicscontroller: '--graphicscontroller',
    boot1: '--boot1',
    boot2: '--boot2',
    boot3: '--boot3',
    boot4: '--boot4',
    chipset: '--chipset',
    firmware: '--firmware',
    mouse: '--mouse',
    keyboard: '--keyboard',
    acpi: '--acpi',
    ioapic: '--ioapic',
    pae: '--pae',
    rtcuseutc: '--rtc-use-utc',
    cpuexecutioncap: '--cpu-execution-cap',
    cpuprofile: '--cpu-profile',
    nestedhwvirt: '--nested-hw-virt',
    hwvirtex: '--hwvirtex',
    nestedpaging: '--nested-paging',
    largepages: '--large-pages',
    paravirtprovider: '--paravirt-provider',
    monitorcount: '--monitor-count',
    accelerate3d: '--accelerate-3d',
    vrde: '--vrde',
    vrdeport: '--vrde-port',
    vrdeauthtype: '--vrde-auth-type',
    recording: '--recording',
    recordingres: '--recording-video-res',
    recordingfps: '--recording-video-fps',
    audioenabled: '--audio-enabled',
    audiodriver: '--audio-driver',
    audioin: '--audio-in',
    audioout: '--audio-out',
    clipboardmode: '--clipboard-mode',
    clipboardfiletransfers: '--clipboard-file-transfers',
    draganddrop: '--drag-and-drop',
    snapshotfolder: '--snapshot-folder',
  };
  for (const [key, flag] of Object.entries(map)) {
    if (fields[key] != null && fields[key] !== '') {
      args.push(flag, String(fields[key]));
    }
  }
  if (args.length === 2) return { ok: true }; // nothing to change
  await runVBoxManage(args);
  return { ok: true };
}

// Enables/disables autostart. Kept OUT of modifyVm()'s batched call
// deliberately: confirmed by testing that `--autostart-enabled on` fails
// hard on any host where the autostart database isn't configured
// (`VBoxManage setproperty autostartdbpath <path>`, a host-level admin step
// this app doesn't set up) - and modifyvm applies its flags atomically, so a
// failing autostart flag would roll back every OTHER flag in the same call
// too. Issuing it as its own call means that failure can't take down an
// otherwise-successful save of everything else.
async function configureAutostart(uuid, { enabled, delaySeconds }) {
  const args = ['modifyvm', uuid];
  if (enabled === 'on' || enabled === 'off') args.push('--autostart-enabled', enabled);
  if (delaySeconds != null && delaySeconds !== '') args.push('--autostart-delay', String(delaySeconds));
  if (args.length === 2) return { ok: true };
  await runVBoxManage(args);
  return { ok: true };
}

// --- Network (per-adapter config, NIC1-4) ---
//
// Unlike Storage, this is a fixed set of fields (4 adapters, each with a
// handful of settings) rather than a dynamic list, so it's applied through
// one batched modifyvm call - same pattern as modifyVm() above, just with
// indexed flag names and one wrinkle: which flag carries the "target" value
// (network/adapter name) depends on the attachment type.

const NIC_ATTACHMENTS = ['none', 'nat', 'bridged', 'intnet', 'hostonly', 'natnetwork'];
const NIC_TYPES = ['Am79C970A', 'Am79C973', '82540EM', '82543GC', '82545EM', 'virtio'];

// Which --xxx-adapterN/--intnetN/--nat-networkN flag carries the "target"
// value for a given attachment type. Attachment types with no target flag
// (none, nat) are omitted.
const NIC_TARGET_FLAGS = {
  bridged: '--bridge-adapter',
  hostonly: '--host-only-adapter',
  intnet: '--intnet',
  natnetwork: '--nat-network',
};

function buildNicArgs(n, nic = {}) {
  const args = [];
  if (nic.attachment) args.push(`--nic${n}`, nic.attachment);
  if (nic.nictype) args.push(`--nic-type${n}`, nic.nictype);
  if (nic.macaddress) args.push(`--mac-address${n}`, nic.macaddress);
  // Strict 'on'/'off' check (not truthiness) - matches modifyVm's boolean
  // convention elsewhere and avoids a boolean slipping through to execFile.
  if (nic.cableconnected === 'on' || nic.cableconnected === 'off') {
    args.push(`--cable-connected${n}`, nic.cableconnected);
  }
  const targetFlag = NIC_TARGET_FLAGS[nic.attachment];
  if (targetFlag && nic.target) args.push(`${targetFlag}${n}`, nic.target);
  return args;
}

// Applies settings for adapters 1..nics.length in one modifyvm call.
async function configureNics(uuid, nics) {
  const args = ['modifyvm', uuid];
  nics.forEach((nic, i) => args.push(...buildNicArgs(i + 1, nic)));
  if (args.length === 2) return { ok: true }; // nothing to change
  await runVBoxManage(args);
  return { ok: true };
}

// Parses NIC1..count out of a getVmInfo() result. `target` reads whichever
// of bridgeadapterN/hostonlyadapterN/intnetN/nat-networkN is present for
// that adapter's current attachment type.
function parseNics(info, count = 4) {
  const nics = [];
  for (let n = 1; n <= count; n++) {
    nics.push({
      index: n,
      attachment: info[`nic${n}`] || 'none',
      nictype: info[`nictype${n}`] || '',
      macaddress: info[`macaddress${n}`] || '',
      cableconnected: info[`cableconnected${n}`] === 'on',
      target: info[`bridgeadapter${n}`] || info[`hostonlyadapter${n}`] || info[`intnet${n}`] || info[`nat-network${n}`] || '',
    });
  }
  return nics;
}

// --- Shared Folders ---
//
// Add/remove only, like USB filters: readonly/automount/auto-mount-point are
// accepted by `sharedfolder add` but (confirmed by testing) never appear in
// showvminfo in any form, so they can't be shown in a list or safely
// round-tripped through an in-place edit. Removal is by name, not index -
// simpler than Storage/USB filters.

function parseSharedFolders(info) {
  const folders = [];
  for (let n = 1; info[`SharedFolderNameMachineMapping${n}`] != null; n++) {
    folders.push({
      index: n,
      name: info[`SharedFolderNameMachineMapping${n}`],
      hostpath: info[`SharedFolderPathMachineMapping${n}`] || '',
    });
  }
  return folders;
}

async function addSharedFolder(uuid, { name, hostpath, readonly, automount }) {
  const args = ['sharedfolder', 'add', uuid, '--name', name, '--hostpath', hostpath];
  if (readonly) args.push('--readonly');
  if (automount) args.push('--automount');
  await runVBoxManage(args);
  return { ok: true };
}

async function removeSharedFolder(uuid, name) {
  await runVBoxManage(['sharedfolder', 'remove', uuid, '--name', name]);
  return { ok: true };
}

// --- USB (controller + device filters) ---
//
// Controller enable flags are batched like Network/Serial (fixed 3 booleans).
// Device filters are a dynamic list managed via a separate `usbfilter`
// subcommand (add/remove only, no in-place edit) - same shape as Storage.
// Note: the filter's action (hold/ignore) is NOT exposed by showvminfo in
// any form (confirmed by testing) - only add/remove are supported here, so
// this never needs to be read back and resent (no risk of silently losing
// it, unlike a field that would need round-tripping through an edit form).

async function configureUsb(uuid, { ohci, ehci, xhci }) {
  const args = ['modifyvm', uuid];
  if (ohci === 'on' || ohci === 'off') args.push('--usb-ohci', ohci);
  if (ehci === 'on' || ehci === 'off') args.push('--usb-ehci', ehci);
  if (xhci === 'on' || xhci === 'off') args.push('--usb-xhci', xhci);
  if (args.length === 2) return { ok: true };
  await runVBoxManage(args);
  return { ok: true };
}

// Parses USB1..N device filters out of a getVmInfo() result.
function parseUsbFilters(info) {
  const filters = [];
  for (let n = 1; info[`USBFilterName${n}`] != null; n++) {
    filters.push({
      index: n,
      name: info[`USBFilterName${n}`],
      active: info[`USBFilterActive${n}`] === 'on',
      vendorid: info[`USBFilterVendorId${n}`] || '',
      productid: info[`USBFilterProductId${n}`] || '',
      manufacturer: info[`USBFilterManufacturer${n}`] || '',
      product: info[`USBFilterProduct${n}`] || '',
      serialnumber: info[`USBFilterSerialNumber${n}`] || '',
    });
  }
  return filters;
}

// Adds a new device filter. `nextIndex` is 0-based and must be the current
// filter count (append) - the caller determines it via
// parseUsbFilters(info).length since VBoxManage has no "just append" mode.
async function addUsbFilter(uuid, nextIndex, { name, action, vendorid, productid, manufacturer, product, serialnumber }) {
  const args = [
    'usbfilter', 'add', String(nextIndex),
    '--target', uuid,
    '--name', name,
    '--action', action,
  ];
  if (vendorid) args.push('--vendorid', vendorid);
  if (productid) args.push('--productid', productid);
  if (manufacturer) args.push('--manufacturer', manufacturer);
  if (product) args.push('--product', product);
  if (serialnumber) args.push('--serialnumber', serialnumber);
  await runVBoxManage(args);
  return { ok: true };
}

// Removes a filter by its 0-based index (parseUsbFilters()'s 1-based
// `index` minus one). Remaining filters shift down to fill the gap.
async function removeUsbFilter(uuid, zeroBasedIndex) {
  await runVBoxManage(['usbfilter', 'remove', String(zeroBasedIndex), '--target', uuid]);
  return { ok: true };
}

// --- Serial ports (UART1-4) ---
//
// Same batched-modifyvm shape as Network. Two wrinkles in VBoxManage's own
// format, confirmed by testing directly rather than assumed:
//   --uartN takes TWO argv values (io-base, irq), not one combined string.
//   --uart-modeN takes a mode keyword + target ("server /path/to/pipe",
//   "tcpserver 4321"), EXCEPT passing a real host device (e.g. /dev/ttyUSB0)
//   which takes no keyword at all - just the raw path.

const UART_MODES = ['disconnected', 'server', 'client', 'tcpserver', 'tcpclient', 'file', 'hostdevice'];
const UART_TYPES = ['16450', '16550A', '16750'];

function buildUartArgs(n, port = {}) {
  const args = [];
  if (!port.enabled) {
    args.push(`--uart${n}`, 'off');
    return args;
  }
  if (port.iobase && port.irq) args.push(`--uart${n}`, port.iobase, String(port.irq));
  if (port.uarttype) args.push(`--uart-type${n}`, port.uarttype);
  if (port.mode === 'disconnected') {
    args.push(`--uart-mode${n}`, 'disconnected');
  } else if (port.mode === 'hostdevice') {
    if (port.target) args.push(`--uart-mode${n}`, port.target);
  } else if (port.mode && port.target) {
    args.push(`--uart-mode${n}`, port.mode, port.target);
  }
  return args;
}

async function configureUarts(uuid, ports) {
  const args = ['modifyvm', uuid];
  ports.forEach((port, i) => args.push(...buildUartArgs(i + 1, port)));
  if (args.length === 2) return { ok: true };
  await runVBoxManage(args);
  return { ok: true };
}

// Parses UART1..count out of a getVmInfo() result.
function parseUarts(info, count = 4) {
  const ports = [];
  for (let n = 1; n <= count; n++) {
    const uartRaw = info[`uart${n}`] || 'off';
    const enabled = uartRaw !== 'off';
    const [iobase = '', irq = ''] = enabled ? uartRaw.split(',') : [];
    const modeRaw = info[`uartmode${n}`] || 'disconnected';
    let mode = 'disconnected';
    let target = '';
    if (modeRaw !== 'disconnected') {
      const comma = modeRaw.indexOf(',');
      if (comma === -1) {
        mode = 'hostdevice';
        target = modeRaw;
      } else {
        mode = modeRaw.slice(0, comma);
        target = modeRaw.slice(comma + 1);
      }
    }
    ports.push({ index: n, enabled, iobase, irq, uarttype: info[`uarttype${n}`] || '16550A', mode, target });
  }
  return ports;
}

// --- Storage (controllers, disks, ISOs) ---
//
// Unlike modifyvm, storage is managed via two separate subcommands:
// `storagectl` (add/remove a controller) and `storageattach` (attach/detach/
// eject a medium on a controller's port+device). There is no single "set
// these fields" call - each action is its own VBoxManage invocation.

const STORAGE_BUSES = ['ide', 'sata', 'scsi', 'sas', 'usb', 'pcie', 'floppy'];

// One reasonable controller chipset per bus, so the UI can offer a simple
// bus choice without also asking for a chipset (VBoxManage still needs one).
const BUS_DEFAULT_CONTROLLER = {
  ide: 'PIIX4',
  sata: 'IntelAhci',
  scsi: 'LSILogic',
  sas: 'LSILogicSAS',
  usb: 'USB',
  pcie: 'NVMe',
  floppy: 'I82078',
};

// Valid --portcount range per bus, confirmed by testing directly against
// VBoxManage (it rejects anything outside these with "Invalid port count").
// Several buses have a single fixed count VBoxManage insists on - min===max
// there means the value isn't actually configurable, whatever the UI sends.
const BUS_PORT_RANGE = {
  ide: { min: 2, max: 2 },
  sata: { min: 1, max: 30 },
  scsi: { min: 16, max: 16 },
  sas: { min: 1, max: 255 },
  usb: { min: 8, max: 8 },
  pcie: { min: 1, max: 255 },
  floppy: { min: 1, max: 1 },
};

// Clamps a requested port count into the bus's valid range. For fixed-count
// buses (min===max) this ignores the request entirely and returns the only
// value VBoxManage accepts, so a stale/generic form value can't fail here.
function clampPortCountForBus(bus, requested) {
  const range = BUS_PORT_RANGE[bus];
  if (!range) return requested;
  return Math.min(Math.max(requested || range.min, range.min), range.max);
}

// Parses storage controllers + their port/device attachments out of a
// getVmInfo() result. showvminfo --machinereadable exposes controllers as
// storagecontrollername0, storagecontrollertype0, ... and each attachment as
// a key literally named "<controller-name>-<port>-<device>".
function parseStorage(info) {
  const controllers = [];
  for (let i = 0; info[`storagecontrollername${i}`] != null; i++) {
    const name = info[`storagecontrollername${i}`];
    const portCount = parseInt(info[`storagecontrollerportcount${i}`], 10) || 0;
    const attachments = [];
    for (let port = 0; port < portCount; port++) {
      for (let device = 0; device < 2; device++) {
        const medium = info[`${name}-${port}-${device}`];
        if (medium == null) continue;
        attachments.push({
          port,
          device,
          medium,
          isEjected: info[`${name}-IsEjected-${port}-${device}`] === 'on',
        });
      }
    }
    controllers.push({
      name,
      type: info[`storagecontrollertype${i}`] || '',
      portCount,
      bootable: info[`storagecontrollerbootable${i}`] === 'on',
      attachments,
    });
  }
  return controllers;
}

// Adds a storage controller. `bus` picks both the VBox bus and a sensible
// default chipset for it (see BUS_DEFAULT_CONTROLLER).
async function addStorageController(uuid, { name, bus, portCount }) {
  const chip = BUS_DEFAULT_CONTROLLER[bus];
  if (!chip) throw new VBoxError(`Invalid bus type: ${bus}`, { code: 'INVALID_BUS' });
  const args = ['storagectl', uuid, '--name', name, '--add', bus, '--controller', chip];
  args.push('--portcount', String(clampPortCountForBus(bus, portCount)));
  await runVBoxManage(args);
  return { ok: true };
}

async function removeStorageController(uuid, name) {
  await runVBoxManage(['storagectl', uuid, '--name', name, '--remove']);
  return { ok: true };
}

// Attaches, detaches, or ejects a medium on a controller's port+device.
// `medium`: 'none' (detach/empty), 'emptydrive' (eject, optical only), or an
// absolute path to an existing disk/ISO image.
async function attachMedium(uuid, { storagectl, port, device, type, medium }) {
  await runVBoxManage([
    'storageattach', uuid,
    '--storagectl', storagectl,
    '--port', String(port),
    '--device', String(device),
    '--type', type,
    '--medium', medium,
  ]);
  return { ok: true };
}

// Guesses which VBoxManage medium registry ('disk'|'dvd'|'floppy') a medium
// belongs to, from its file extension. `closemedium` needs to be told which
// registry to look in; this only picks the subcommand, it never affects
// which file gets deleted (the caller always passes the exact attached path).
function mediumRegistryType(mediumPath) {
  const ext = path.extname(mediumPath).toLowerCase();
  if (ext === '.iso' || ext === '.dmg') return 'dvd';
  if (ext === '.img') return 'floppy';
  return 'disk';
}

// Detaches whatever is attached at a controller's port+device, then
// permanently deletes that medium's underlying file from the host and
// unregisters it from VirtualBox's media registry. Irreversible - caller is
// responsible for confirmation. `medium` must be the currently-attached
// path/UUID as read back from parseStorage(), never raw user input (the
// route handler looks it up server-side rather than trusting a submitted
// value, so a request can't be crafted to delete an arbitrary host file).
async function deleteAttachedMedium(uuid, { storagectl, port, device, medium }) {
  await attachMedium(uuid, { storagectl, port, device, type: 'hdd', medium: 'none' });
  await runVBoxManage(['closemedium', mediumRegistryType(medium), medium, '--delete']);
  return { ok: true };
}

// Disk formats offered for new-disk creation, confirmed by testing directly
// against `VBoxManage createmedium disk --format <x>`. VHDX is a real backend
// (see `list hddbackends`) but VBoxManage rejects it for dynamic creation
// ("Medium format 'VHDX' does not support dynamic storage creation"), so it's
// left out here rather than exposed as an option that always fails.
//
// The extension map matters because VBoxManage's own auto-extension when
// --filename has none isn't reliable: a disk created with --format QCOW and
// no extension came back named ".vdi" despite genuinely being QCOW content
// (confirmed by testing). Callers should always build the filename with the
// matching extension from this map rather than relying on VBoxManage to
// pick one.
const DISK_FORMATS = ['VDI', 'VMDK', 'VHD', 'QCOW'];
const DISK_FORMAT_EXTENSIONS = { VDI: 'vdi', VMDK: 'vmdk', VHD: 'vhd', QCOW: 'qcow2' };

// Creates a new blank disk image in the given format and returns its UUID
// (caller attaches it separately via attachMedium).
async function createDisk({ filename, sizeMB, format = 'VDI' }) {
  const { stdout } = await runVBoxManage([
    'createmedium', 'disk',
    '--filename', filename,
    '--size', String(sizeMB),
    '--format', format,
  ]);
  const m = stdout.match(/UUID:\s*(\S+)/);
  if (!m) throw new VBoxError('Disk created but could not determine its UUID.', { code: 'CREATE_NO_UUID' });
  return { ok: true, uuid: m[1] };
}

// --- Virtual media (host-wide, not scoped to one VM) ---
//
// `VBoxManage list [hdds|dvds|floppies] --long` shows every medium
// VirtualBox has ever created or attached, including ones no VM currently
// references (e.g. after a detach-only, the file is never deleted unless
// closemedium --delete is used - see deleteAttachedMedium above). This is
// the "Virtual Media Manager" equivalent: a host-wide inventory rather than
// one VM's Storage tab.

const MEDIUM_KINDS = ['disk', 'dvd', 'floppy'];
// VBoxManage names the same concept differently across subcommands:
// `list` wants the plural registry name, `closemedium`/`createmedium` want
// the singular kind.
const MEDIUM_LIST_SUBCOMMAND = { disk: 'hdds', dvd: 'dvds', floppy: 'floppies' };

// Parses `VBoxManage list --long <hdds|dvds|floppies>` output into records.
// Entries are separated by a blank line; each line is "Key:   value". A
// medium currently attached to a VM gets one "In use by VMs" line per VM
// (rare to have more than one) - those are collected into an array instead
// of overwriting, since every other key is a single value.
function parseMediumList(stdout) {
  const blocks = stdout.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const record = { inUseByVMs: [] };
    for (const rawLine of block.split(/\r?\n/)) {
      const idx = rawLine.indexOf(':');
      if (idx === -1) continue;
      const key = rawLine.slice(0, idx).trim();
      const value = rawLine.slice(idx + 1).trim();
      if (key === 'In use by VMs') {
        record.inUseByVMs.push(value);
      } else {
        record[key] = value;
      }
    }
    return record;
  });
}

async function listMedia(kind) {
  const { stdout } = await runVBoxManage(['list', MEDIUM_LIST_SUBCOMMAND[kind], '--long']);
  return parseMediumList(stdout).map((r) => ({ ...r, kind }));
}

// All registered media across all three kinds, flattened into one array.
async function listAllMedia() {
  const lists = await Promise.all(MEDIUM_KINDS.map((kind) => listMedia(kind)));
  return lists.flat();
}

// Permanently deletes a medium that isn't attached to any VM, and
// unregisters it. VBoxManage itself refuses this while a medium is attached
// (use deleteAttachedMedium to detach-then-delete in that case) - the route
// handler also checks inUseByVMs server-side first so this only ever runs
// against something already confirmed orphaned.
async function deleteUnattachedMedium(kind, medium) {
  await runVBoxManage(['closemedium', kind, medium, '--delete']);
  return { ok: true };
}

// Registers an existing disk/ISO/floppy file with VirtualBox (so it shows up
// in listAllMedia/`list hdds|dvds|floppies`) without attaching it to any VM.
// Modern VBoxManage has no direct "register" command (the old `openmedium`
// was removed) - referencing a not-yet-known file by path in a
// medium-related command implicitly opens/registers it as a side effect;
// `showmediuminfo` is the least destructive one to use for that (confirmed:
// closemedium without --delete de-registers-but-keeps-the-file, then
// showmediuminfo on that same path re-registers it).
async function registerMedium(kind, filePath) {
  await runVBoxManage(['showmediuminfo', kind, filePath]);
  return { ok: true };
}

// Stops a VM. mode: 'acpi' (graceful, default) or 'hard' (poweroff).
// The mode is mapped through a fixed whitelist - the raw value is never
// passed to VBoxManage (defense in depth, per ARCHITECTURE.md section 8).
const STOP_MODES = {
  acpi: 'acpipowerbutton',
  hard: 'poweroff',
};

async function stopVm(uuid, mode = 'acpi') {
  const vboxAction = STOP_MODES[mode];
  if (!vboxAction) {
    throw new VBoxError(`Invalid stop mode: ${mode}`, { code: 'INVALID_STOP_MODE' });
  }
  const { stdout, stderr } = await runVBoxManage(['controlvm', uuid, vboxAction]);
  return { ok: true, message: (stdout || stderr || '').trim() };
}

// Captures a PNG screenshot of the VM's screen and returns it as a Buffer.
// VBoxManage writes to a file path, so we use a temp file and read it back.
// Throws VBoxError (often because the VM isn't running) on failure.
async function screenshot(uuid) {
  const tmpFile = path.join(
    os.tmpdir(),
    `vbm-shot-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
  );
  try {
    await runVBoxManage(['controlvm', uuid, 'screenshotpng', tmpFile], {
      timeoutMs: config.SCREENSHOT_TIMEOUT_MS,
    });
    return await fsp.readFile(tmpFile);
  } finally {
    // Best-effort cleanup; ignore if it was never created.
    fsp.unlink(tmpFile).catch(() => {});
  }
}

// --- Networks (host-wide - NAT Networks, host-only interfaces, and
// read-only info on bridged/internal networks; NOT the per-VM NIC settings
// in modifyVm/configureNics above, which just pick which of these a specific
// VM's adapter attaches to) ---
//
// VBoxManage's own --help text advertises a newer `hostonlynet` subcommand
// (host-only NETWORKS, plural object model) alongside the older `hostonlyif`
// (host-only INTERFACES) - but confirmed by testing directly against this
// host's VBoxManage build, `hostonlynet` and `list hostonlynets` both fail
// ("Invalid command" / "Unknown subcommand") despite appearing in the
// generic usage text, while `hostonlyif`, `natnetwork`, and `dhcpserver` all
// work. `VBoxManage commands` (the authoritative per-build list) confirms
// hostonlynet just isn't implemented here. This module only exposes what
// actually works rather than a model this build doesn't support.

// Shared parser for the blank-line-separated "Key:   value" blocks used by
// `list natnets/hostonlyifs/bridgedifs/dhcpservers --long`. Nested/indented
// sub-lines (e.g. dhcpservers' "Global Configuration" block) still contain a
// colon, so they parse into extra keys on the same record - harmless, since
// callers only read the specific top-level fields they need.
function parseKeyValueBlocks(stdout) {
  const blocks = stdout.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const record = {};
    for (const rawLine of block.split(/\r?\n/)) {
      const idx = rawLine.indexOf(':');
      if (idx === -1) continue;
      const key = rawLine.slice(0, idx).trim();
      const value = rawLine.slice(idx + 1).trim();
      record[key] = value;
    }
    return record;
  });
}

// NAT Networks: named, host-wide NAT networks any VM can attach to (a VM's
// NIC picks one via --nic<N> natnetwork --nat-network<N> <name>, see
// configureNics above). Each manages its own DHCP server internally via the
// --dhcp flag here - unlike host-only interfaces, which use the separate
// `dhcpserver` subsystem below.
async function listNatNetworks() {
  const { stdout } = await runVBoxManage(['list', 'natnets', '--long']);
  return parseKeyValueBlocks(stdout);
}

async function addNatNetwork({ name, network, dhcp }) {
  await runVBoxManage([
    'natnetwork', 'add',
    '--netname', name,
    '--network', network,
    '--enable',
    '--dhcp', dhcp ? 'on' : 'off',
  ]);
  return { ok: true };
}

async function removeNatNetwork(name) {
  await runVBoxManage(['natnetwork', 'remove', '--netname', name]);
  return { ok: true };
}

// Host-only interfaces: host-side virtual NICs (vboxnetN) a VM can attach to
// for host<->guest-only networking. VBoxManage assigns the name itself on
// create (confirmed by testing: no flag requests a specific one).
async function listHostOnlyInterfaces() {
  const { stdout } = await runVBoxManage(['list', 'hostonlyifs', '--long']);
  return parseKeyValueBlocks(stdout);
}

async function createHostOnlyInterface() {
  const { stdout } = await runVBoxManage(['hostonlyif', 'create']);
  const m = stdout.match(/Interface '([^']+)' was successfully created/);
  return { ok: true, name: m ? m[1] : null };
}

async function removeHostOnlyInterface(name) {
  await runVBoxManage(['hostonlyif', 'remove', name]);
  return { ok: true };
}

// VirtualBox restricts host-only/NAT-network IP ranges to a built-in default
// allow-list (192.168.56.0/21 and its IPv6 equivalent) unless this file
// explicitly permits others - confirmed by testing: setting a host-only
// adapter's IP outside the allowed range fails with a misleading "permission
// denied" from VBoxNetAdpCtl, which is actually this policy rejecting the
// range, not a Unix permission problem. Fixed system path (VirtualBox's own,
// not app config) - read-only, informational for the Networks page.
const NETWORKS_CONF_PATH = '/etc/vbox/networks.conf';

async function readNetworksConf() {
  try {
    const raw = await fsp.readFile(NETWORKS_CONF_PATH, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    return { path: NETWORKS_CONF_PATH, exists: true, lines };
  } catch (err) {
    if (err.code === 'ENOENT') return { path: NETWORKS_CONF_PATH, exists: false, lines: [] };
    return { path: NETWORKS_CONF_PATH, exists: true, lines: [], error: err.message };
  }
}

// Runs VBoxNetAdpCtl directly (bypassing VBoxManage/VBoxSVC entirely). Only
// used as a fallback below - see the comment there for why. Never invokes a
// shell; args are passed as a literal argv array like runVBoxManage.
function runVBoxNetAdpCtl(args) {
  return new Promise((resolve, reject) => {
    execFile(
      config.VBOXNETADPCTL_BIN,
      args,
      { timeout: config.VBOXMANAGE_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new VBoxError(`VBoxNetAdpCtl failed: ${String(stderr || err.message).trim()}`, {
              code: 'VBOXNETADPCTL_FAILED',
              stderr: String(stderr || ''),
              cause: err,
            })
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

// Sets the host-only adapter itself to obtain its IP via DHCP (client mode)
// instead of a static address - for when an external DHCP server (not
// VirtualBox's own, see the DHCP *server* functions below - a different
// feature) is already serving that network. Unlike the static-IP path
// above, there's no VBoxNetAdpCtl fallback available for this - confirmed
// `VBoxNetAdpCtl <adapter> <address> [netmask <address>] | remove` has no
// DHCP mode at all - so this relies solely on runVBoxManage's own retry.
async function setHostOnlyInterfaceDhcp(name) {
  await runVBoxManage(['hostonlyif', 'ipconfig', name, '--dhcp']);
  return { ok: true };
}

async function configureHostOnlyInterfaceIp(name, { ip, netmask }) {
  try {
    await runVBoxManage(['hostonlyif', 'ipconfig', name, '--ip', ip, '--netmask', netmask]);
    return { ok: true };
  } catch (err) {
    // Confirmed by testing and cross-checked against VBoxSVC.log: on some
    // hosts, VBoxSVC can fail for several seconds after it (re)starts to
    // spawn its own VBoxNetAdpCtl helper ("NetIfAdpCtl: failed to create
    // process ... iStats=38"), surfacing here as a misleading E_ACCESSDENIED
    // even though it's not a real permission problem - invoking the exact
    // same setuid helper directly, bypassing VBoxSVC, works reliably. Fall
    // back to that rather than leaving a simple IP change stuck behind an
    // upstream VBoxSVC race that already exhausted runVBoxManage's retries.
    const isAccessDenied =
      err instanceof VBoxError && /E_ACCESSDENIED|Access denied/i.test(String(err.stderr || err.message));
    if (!isAccessDenied) throw err;
    await runVBoxNetAdpCtl([name, ip, 'netmask', netmask]);
    return { ok: true };
  }
}

// DHCP servers for host-only interfaces (NAT Networks manage their own DHCP
// inline via addNatNetwork above, so this subsystem is only relevant to
// hostonlyif). VBoxManage names the underlying network
// "HostInterfaceNetworking-<ifname>" for a host-only interface (confirmed by
// testing) - that's how a DHCP server record is matched back to its
// interface when listing.
function dhcpNetworkNameForInterface(ifname) {
  return `HostInterfaceNetworking-${ifname}`;
}

async function listDhcpServers() {
  const { stdout } = await runVBoxManage(['list', 'dhcpservers', '--long']);
  return parseKeyValueBlocks(stdout);
}

async function addDhcpServer(ifname, { serverIp, netmask, lowerIp, upperIp }) {
  await runVBoxManage([
    'dhcpserver', 'add',
    '--interface', ifname,
    '--server-ip', serverIp,
    '--netmask', netmask,
    '--lower-ip', lowerIp,
    '--upper-ip', upperIp,
    '--enable',
  ]);
  return { ok: true };
}

async function removeDhcpServer(ifname) {
  await runVBoxManage(['dhcpserver', 'remove', '--interface', ifname]);
  return { ok: true };
}

// Bridged interfaces: the host's own physical/virtual NICs, listed only for
// reference (e.g. to know a valid value for a VM's Bridged adapter target) -
// VBoxManage has no add/remove for these; they just mirror the host's NICs.
async function listBridgedInterfaces() {
  const { stdout } = await runVBoxManage(['list', 'bridgedifs', '--long']);
  return parseKeyValueBlocks(stdout);
}

// Internal networks: informal names a VM references directly on its NIC
// config (--intnet<N> <name>) - VBoxManage only reports which names are
// currently in use; there's no separate object to create/remove.
async function listInternalNetworks() {
  const { stdout } = await runVBoxManage(['list', 'intnets']);
  // Unlike hdds/natnets/hostonlyifs/bridgedifs, this output has no blank
  // line between entries - just one "Name: x" line per network (confirmed
  // by testing) - so parseKeyValueBlocks would treat the whole output as one
  // block and each line would overwrite the same key, keeping only the last
  // entry. Parse it directly instead.
  const names = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const m = /^Name:\s*(.+)$/.exec(rawLine.trim());
    if (m) names.push(m[1].trim());
  }
  return names;
}

module.exports = {
  VBoxError,
  runVBoxManage,
  parseMachineReadable,
  listVms,
  runningVmUuids,
  getVmInfo,
  getVmStatus,
  startVm,
  stopVm,
  screenshot,
  createVm,
  deleteVm,
  modifyVm,
  configureAutostart,
  NIC_ATTACHMENTS,
  NIC_TYPES,
  configureNics,
  parseNics,
  UART_MODES,
  UART_TYPES,
  configureUarts,
  parseUarts,
  configureUsb,
  parseUsbFilters,
  addUsbFilter,
  removeUsbFilter,
  parseSharedFolders,
  addSharedFolder,
  removeSharedFolder,
  STORAGE_BUSES,
  BUS_PORT_RANGE,
  clampPortCountForBus,
  parseStorage,
  addStorageController,
  removeStorageController,
  attachMedium,
  deleteAttachedMedium,
  createDisk,
  DISK_FORMATS,
  DISK_FORMAT_EXTENSIONS,
  MEDIUM_KINDS,
  listAllMedia,
  deleteUnattachedMedium,
  registerMedium,
  listNatNetworks,
  addNatNetwork,
  removeNatNetwork,
  listHostOnlyInterfaces,
  readNetworksConf,
  createHostOnlyInterface,
  removeHostOnlyInterface,
  configureHostOnlyInterfaceIp,
  setHostOnlyInterfaceDhcp,
  dhcpNetworkNameForInterface,
  listDhcpServers,
  addDhcpServer,
  removeDhcpServer,
  listBridgedInterfaces,
  listInternalNetworks,
};
