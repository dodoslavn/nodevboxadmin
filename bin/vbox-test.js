#!/usr/bin/env node
'use strict';

// Manual test script for lib/vbox.js. Run on the actual VirtualBox host,
// as the OS user that owns the VMs (see docs/manual.md - VM config lives
// under a specific user, so run this the same way, e.g.):
//
//   sudo -u virtualbox node bin/vbox-test.js list
//   sudo -u virtualbox node bin/vbox-test.js info <uuid-or-name>
//   sudo -u virtualbox node bin/vbox-test.js status <uuid>
//   sudo -u virtualbox node bin/vbox-test.js start <uuid>
//   sudo -u virtualbox node bin/vbox-test.js stop <uuid> [acpi|hard]
//   sudo -u virtualbox node bin/vbox-test.js screenshot <uuid> [outfile.png]
//
// This is a developer/ops aid, not part of the web app. It never takes input
// from the network.

const fsp = require('node:fs/promises');
const vbox = require('../lib/vbox');

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2);

  switch (cmd) {
    case 'list': {
      const vms = await vbox.listVms();
      const running = await vbox.runningVmUuids();
      if (!vms.length) {
        console.log('No VMs registered.');
        return;
      }
      for (const vm of vms) {
        const state = running.has(vm.uuid.toLowerCase()) ? 'running' : 'stopped';
        console.log(`${state.padEnd(8)} ${vm.uuid}  ${vm.name}`);
      }
      return;
    }
    case 'info': {
      requireArg(arg1, 'uuid-or-name');
      console.log(await vbox.getVmInfo(arg1));
      return;
    }
    case 'status': {
      requireArg(arg1, 'uuid');
      console.log(await vbox.getVmStatus(arg1));
      return;
    }
    case 'start': {
      requireArg(arg1, 'uuid');
      console.log(await vbox.startVm(arg1));
      return;
    }
    case 'stop': {
      requireArg(arg1, 'uuid');
      console.log(await vbox.stopVm(arg1, arg2 || 'acpi'));
      return;
    }
    case 'screenshot': {
      requireArg(arg1, 'uuid');
      const outFile = arg2 || `screenshot-${Date.now()}.png`;
      const buf = await vbox.screenshot(arg1);
      await fsp.writeFile(outFile, buf);
      console.log(`Wrote ${buf.length} bytes to ${outFile}`);
      return;
    }
    default:
      console.error('Usage: node bin/vbox-test.js <list|info|status|start|stop|screenshot> [args]');
      process.exit(1);
  }
}

function requireArg(value, name) {
  if (!value) {
    console.error(`ERROR: missing required argument: <${name}>`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n[${err.code || 'ERROR'}] ${err.message}`);
  if (err.stderr) console.error('--- stderr ---\n' + err.stderr);
  process.exit(1);
});
