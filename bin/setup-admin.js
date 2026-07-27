#!/usr/bin/env node
'use strict';

// One-off CLI to set (or reset) the single admin credential.
// Run manually at deploy time:  node bin/setup-admin.js
//
// Prompts for username + password on stdin (password not echoed) and writes
// data/config.json with a fresh scrypt hash + salt. Never exposed over HTTP.
//
// Supports non-interactive use for automation:
//   VBM_ADMIN_USER=admin VBM_ADMIN_PASS=secret node bin/setup-admin.js --non-interactive

const readline = require('node:readline');
const config = require('../lib/config');
const auth = require('../lib/auth');
const store = require('../lib/store');

function ask(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(question, (answer) => resolve(answer));
      return;
    }
    // Hidden input: mute echo by overriding the output writer.
    const onData = (char) => {
      char = String(char);
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.removeListener('data', onData);
      }
    };
    process.stdout.write(question);
    rl.stdoutMuted = true;
    rl._writeToOutput = function (str) {
      if (rl.stdoutMuted) {
        // Only write the newline, mask everything else.
        if (str.includes('\n')) rl.output.write('\n');
        return;
      }
      rl.output.write(str);
    };
    rl.question('', (answer) => {
      rl.stdoutMuted = false;
      resolve(answer);
    });
    process.stdin.on('data', onData);
  });
}

function printHelp() {
  console.log(`Usage: node bin/setup-admin.js [options]

Sets (or resets) the single admin login for nodevboxadmin.

Options:
  --non-interactive   Read credentials from env vars instead of prompting:
                        VBM_ADMIN_USER   admin username
                        VBM_ADMIN_PASS   admin password (min 8 chars)
  -h, --help          Show this help and exit.

With no options, prompts interactively for username + password.

Examples:
  node bin/setup-admin.js
  VBM_ADMIN_USER=admin VBM_ADMIN_PASS=secretpw node bin/setup-admin.js --non-interactive`);
}

async function main() {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    printHelp();
    return;
  }

  const nonInteractive = process.argv.includes('--non-interactive');

  let username;
  let password;

  if (nonInteractive) {
    username = process.env.VBM_ADMIN_USER;
    password = process.env.VBM_ADMIN_PASS;
    if (!username || !password) {
      console.error('ERROR: --non-interactive requires VBM_ADMIN_USER and VBM_ADMIN_PASS env vars.');
      process.exit(1);
    }
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('Set the nodevboxadmin admin login.');
    console.log('You will be asked for a username, then the password TWICE (to confirm).');
    console.log('Password input is hidden - nothing shows as you type. Ctrl+C to cancel.\n');
    username = (await ask(rl, 'Admin username: ')).trim();
    password = await ask(rl, 'Admin password (min 8 chars, hidden): ', { hidden: true });
    const confirm = await ask(rl, 'Confirm password (type it again): ', { hidden: true });
    rl.close();

    if (!username) {
      console.error('ERROR: username cannot be empty.');
      process.exit(1);
    }
    if (password.length < 8) {
      console.error('ERROR: password must be at least 8 characters.');
      process.exit(1);
    }
    if (password !== confirm) {
      console.error('ERROR: passwords do not match.');
      process.exit(1);
    }
  }

  const cred = auth.buildCredential(username, password);
  await store.writeJson(config.CONFIG_FILE, cred);
  console.log(`\nAdmin credential written to ${config.CONFIG_FILE}`);
  console.log(`Username: ${username}`);
}

main().catch((err) => {
  console.error('Failed to set admin credential:', err);
  process.exit(1);
});
