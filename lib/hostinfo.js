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
// startvm fails with VERR_VMX_IN_USE / VERR_SVM_IN_USE. `conflict: true` flips
// the host-page status colour: for these, *loaded* is the bad (red) state and
// *not loaded* is healthy (green) - the opposite of the VBox modules above.
// They're listed in the same kernel-modules table on the host page.
const KVM_MODULES = [
  { name: 'kvm', purpose: 'Linux KVM', conflict: true },
  { name: 'kvm_amd', purpose: 'KVM (AMD-V)', conflict: true },
  { name: 'kvm_intel', purpose: 'KVM (VT-x)', conflict: true },
];

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

  // VBox modules first, then the KVM conflict modules - both rendered in the
  // one kernel-modules table on the host page (conflict rows flip the colour).
  const withLoaded = (m) => ({ ...m, loaded: loaded ? loaded.has(m.name) : null }); // null = couldn't check
  const modules = [...VBOX_MODULES.map(withLoaded), ...KVM_MODULES.map(withLoaded)];
  const requiredMissing = modules.some((m) => m.required && m.loaded === false);

  // Which KVM modules (if any) are currently holding VT-x/AMD-V. null when we
  // couldn't read /proc/modules at all. Drives the conflict banner.
  const kvmModules = loaded ? KVM_MODULES.filter((m) => loaded.has(m.name)).map((m) => m.name) : null;
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

// VM CPU/memory commitment, as "running / all registered" totals:
//   runCpus  = vCPUs summed over currently running VMs
//   allCpus  = vCPUs summed over every registered VM (running + stopped)
// (same for memory). The host page renders these as e.g. "10 / 12 vCPUs".
// hostCores/hostMemMB are the physical host totals, shown for context -
// overcommit is normal and allowed by VBox, so allCpus can exceed hostCores.
async function getResourceUsage() {
  const hostCores = os.cpus().length;
  const hostMemMB = Math.round(os.totalmem() / (1024 * 1024));
  try {
    // runningVmUuids() returns a Set of lowercased UUIDs; listVms() UUIDs are
    // not normalized, so compare lowercased on both sides.
    const [vms, running] = await Promise.all([vbox.listVms(), vbox.runningVmUuids()]);
    const acc = { runCpus: 0, allCpus: 0, runMemMB: 0, allMemMB: 0, runningCount: 0, totalCount: 0 };
    // Per-VM showvminfo; VM count on a single host is small. One failed lookup
    // (e.g. an inaccessible VM) shouldn't blank the whole summary.
    await Promise.all(vms.map(async (vm) => {
      let info;
      try { info = await vbox.getVmInfo(vm.uuid); } catch { return; }
      const cpus = parseInt(info.cpus, 10) || 0;
      const mem = parseInt(info.memory, 10) || 0;
      acc.allCpus += cpus; acc.allMemMB += mem; acc.totalCount += 1;
      if (running.has(vm.uuid.toLowerCase())) {
        acc.runCpus += cpus; acc.runMemMB += mem; acc.runningCount += 1;
      }
    }));
    return { available: true, hostCores, hostMemMB, ...acc };
  } catch {
    return { available: false, hostCores, hostMemMB };
  }
}

module.exports = { getHostInfo, getResourceUsage, VBOX_MODULES, KVM_MODULES };
