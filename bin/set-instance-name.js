#!/usr/bin/env node
'use strict';

// One-off CLI to set (or clear) the persisted instance name shown in the
// page title, nav header, and login page - see lib/config.js INSTANCE_NAME.
// Merges onto data/config.json rather than overwriting it, so it doesn't
// touch the admin credential also stored there.
//
//   node bin/set-instance-name.js "prod-hv1"
//   node bin/set-instance-name.js ""   # clears it (falls back to the plain app name)
//
// The INSTANCE_NAME environment variable, if set, always takes priority over
// whatever's persisted here (see lib/config.js). Takes effect on next start.

const config = require('../lib/config');
const store = require('../lib/store');

const MAX_LENGTH = 64;

function printHelp() {
  console.log(`Usage: node bin/set-instance-name.js <name>

Sets (or clears, with an empty string) the persisted instance name for
this nodevboxadmin install. Restart the app for it to take effect.

Examples:
  node bin/set-instance-name.js "prod-hv1"
  node bin/set-instance-name.js ""`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const name = args[0].trim().slice(0, MAX_LENGTH);
  const existing = await store.readJson(config.CONFIG_FILE, {});
  await store.writeJson(config.CONFIG_FILE, { ...existing, instanceName: name });

  if (name) {
    console.log(`Instance name set to "${name}" in ${config.CONFIG_FILE}.`);
  } else {
    console.log(`Instance name cleared in ${config.CONFIG_FILE} (will fall back to the plain app name).`);
  }
  console.log('Restart the app for this to take effect.');
}

main().catch((err) => {
  console.error('Failed to set instance name:', err);
  process.exit(1);
});
