'use strict';

const os = require('node:os');
const fsp = require('node:fs/promises');
const vbox = require('./vbox');

// Host diagnostics for the /host page: uptime, current time, OS version,
// VirtualBox version, and whether VirtualBox's kernel modules are loaded.
// Everything here reads from the local OS (os.*, /proc, /etc/os-release) or
// runs `VBoxManage --version` - no user input involved anywhere.

// The kernel modules VirtualBox ships. vboxdrv is the core module every VM
// needs; the others back specific features and are commonly absent on hosts
// that don't use them, so they're informational rather than an error state.
const VBOX_MODULES = [
  { name: 'vboxdrv', purpose: 'Core driver - required to run any VM', required: true },
  { name: 'vboxnetflt', purpose: 'Bridged networking', required: false },
  { name: 'vboxnetadp', purpose: 'Host-only networking', required: false },
  { name: 'vboxpci', purpose: 'PCI passthrough', required: false },
];

// KVM kernel modules. If any of these is loaded it holds the CPU's hardware
// virtualization extension (VT-x/AMD-V), which VirtualBox then can't use -
// startvm fails with VERR_VMX_IN_USE / VERR_SVM_IN_USE. So for VirtualBox,
// "KVM not loaded" is the healthy state (shown green on the host page).
const KVM_MODULES = ['kvm', 'kvm_amd', 'kvm_intel'];

// Reads /proc/modules directly (always present on Linux, no extra binary
// needed) and returns the set of currently loaded module names.
async function loadedModuleNames() {
  try {
    const raw = await fsp.readFile('/proc/modules', 'utf8');
    const set = new Set();
    for (const line of raw.split('\n')) {
      const name = line.split(/\s+/)[0];
      if (name) set.add(name);
    }
    return set;
  } catch (err) {
    return null; // e.g. non-Linux host, or /proc not mounted
  }
}

// Best-effort distro name from /etc/os-release ("Ubuntu 26.04 LTS" etc.).
async function osPrettyName() {
  try {
    const raw = await fsp.readFile('/etc/os-release', 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^PRETTY_NAME=(.*)$/.exec(line.trim());
      if (m) return m[1].replace(/^"|"$/g, '');
    }
    return '';
  } catch {
    return '';
  }
}

async function vboxVersion() {
  try {
    const { stdout } = await vbox.runVBoxManage(['--version']);
    return stdout.trim();
  } catch (err) {
    return null;
  }
}

async function getHostInfo() {
  const [prettyName, loaded, vboxVer] = await Promise.all([
    osPrettyName(),
    loadedModuleNames(),
    vboxVersion(),
  ]);

  const modules = VBOX_MODULES.map((m) => ({
    ...m,
    loaded: loaded ? loaded.has(m.name) : null, // null = couldn't check (no /proc/modules)
  }));
  const requiredMissing = modules.some((m) => m.required && m.loaded === false);

  // Which KVM modules (if any) are currently holding VT-x/AMD-V. null when we
  // couldn't read /proc/modules at all.
  const kvmModules = loaded ? KVM_MODULES.filter((n) => loaded.has(n)) : null;
  const kvmLoaded = loaded ? kvmModules.length > 0 : null;

  const { username, uid } = os.userInfo();

  return {
    now: new Date(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    uptimeSeconds: os.uptime(),
    hostname: os.hostname(),
    runningAs: uid === -1 ? username : `${username} (uid ${uid})`, // uid -1 on Windows
    platform: os.type(), // e.g. "Linux"
    kernelRelease: os.release(), // e.g. "7.0.0-28-generic"
    arch: os.arch(),
    osPrettyName: prettyName,
    vboxVersion: vboxVer, // null if VBoxManage isn't reachable
    modules,
    modulesCheckable: loaded !== null,
    requiredMissing,
    kvmLoaded, // true = KVM holds VT-x/AMD-V (blocks VBox); false = free; null = couldn't check
    kvmModules, // array of loaded KVM module names, or null
  };
}

// Host CPU/memory capacity vs. what VMs have committed, split by VM run state.
// "used" = sum over running VMs (actually occupying the resource now);
// "assignedOff" = sum over powered-off/registered-but-not-running VMs (would be
// claimed if they were all started). Overcommit is normal and allowed by VBox,
// so these can exceed host totals - the page just reports, it doesn't gate.
async function getResourceUsage() {
  const totalCores = os.cpus().length;
  const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
  try {
    // runningVmUuids() returns a Set of lowercased UUIDs; listVms() UUIDs are
    // not normalized, so compare lowercased on both sides.
    const [vms, running] = await Promise.all([vbox.listVms(), vbox.runningVmUuids()]);
    const acc = {
      usedCores: 0, assignedOffCores: 0, usedMemMB: 0, assignedOffMemMB: 0,
      runningCount: 0, offCount: 0,
    };
    // Per-VM showvminfo; VM count on a single host is small. One failed lookup
    // (e.g. an inaccessible VM) shouldn't blank the whole summary.
    await Promise.all(vms.map(async (vm) => {
      let info;
      try { info = await vbox.getVmInfo(vm.uuid); } catch { return; }
      const cpus = parseInt(info.cpus, 10) || 0;
      const mem = parseInt(info.memory, 10) || 0;
      if (running.has(vm.uuid.toLowerCase())) {
        acc.usedCores += cpus; acc.usedMemMB += mem; acc.runningCount += 1;
      } else {
        acc.assignedOffCores += cpus; acc.assignedOffMemMB += mem; acc.offCount += 1;
      }
    }));
    return { available: true, totalCores, totalMemMB, ...acc };
  } catch {
    return { available: false, totalCores, totalMemMB };
  }
}

module.exports = { getHostInfo, getResourceUsage, VBOX_MODULES, KVM_MODULES };
