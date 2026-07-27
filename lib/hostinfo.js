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
  };
}

module.exports = { getHostInfo, VBOX_MODULES };
