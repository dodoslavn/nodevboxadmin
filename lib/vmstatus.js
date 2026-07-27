'use strict';

const vbox = require('./vbox');

// Lists ALL VirtualBox VMs with live status. No registry/allowlist - every VM
// the host's VirtualBox knows about is shown and manageable.
//
// Returns an array of:
//   { uuid, name, state, running }
//
// Efficiency: two VBoxManage calls total (`list vms`, `list runningvms`)
// rather than one showvminfo per VM. The detail page fetches full info per VM.
//
// On VBoxManage failure, returns { error, vms: [] } so callers can render a
// message instead of crashing.

async function getAll() {
  let all;
  let running;
  try {
    [all, running] = await Promise.all([vbox.listVms(), vbox.runningVmUuids()]);
  } catch (err) {
    let message;
    if (err instanceof vbox.VBoxError && err.code === 'VBOXMANAGE_NOT_FOUND') {
      message = 'VirtualBox tooling not available on this host.';
    } else if (/Failed to create the VirtualBox object|NS_ERROR_FAILURE|COM server/i.test(err.message || '')) {
      // Transient VBoxSVC (COM server) hiccup - it starts on demand and can
      // briefly be unavailable. Refreshing usually fixes it.
      message = 'VirtualBox service is starting up or busy. This is usually temporary - refresh in a moment.';
    } else {
      message = `Could not query VirtualBox: ${err.message}`;
    }
    return { error: message, vms: [] };
  }

  const vms = all.map((vm) => {
    const isRunning = running.has(vm.uuid.toLowerCase());
    return {
      uuid: vm.uuid,
      name: vm.name,
      state: isRunning ? 'running' : 'stopped',
      running: isRunning,
    };
  });

  return { error: '', vms };
}

module.exports = { getAll };
