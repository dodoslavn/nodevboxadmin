'use strict';

const fsp = require('node:fs/promises');
const config = require('./config');

// Append-only audit log of VM actions, one JSON object per line (JSONL).
//
// Each entry:
//   { ts, action, vmId, vmName, result, message?, actor? }
//
// Appends are serialized through a single in-process chain so concurrent
// writes can't interleave a partial line. JSONL (not a JSON array) is used
// deliberately: appending a line is atomic-ish and never requires rewriting
// the whole file, so a crash can at worst lose/truncate the last line rather
// than corrupt the entire history.

let appendChain = Promise.resolve();

function logAction(entry) {
  const record = {
    ts: new Date().toISOString(),
    action: entry.action,
    vmId: entry.vmId != null ? entry.vmId : null,
    vmName: entry.vmName || null,
    result: entry.result, // 'ok' | 'error'
    message: entry.message || null,
    actor: entry.actor || null,
  };
  const line = JSON.stringify(record) + '\n';

  appendChain = appendChain
    .catch(() => {})
    .then(() => fsp.appendFile(config.AUDIT_LOG_FILE, line, { mode: 0o600 }));
  return appendChain;
}

// Reads recent audit entries, newest first. If vmId is provided, only entries
// for that VM are returned. `limit` caps the result count.
async function readRecent({ vmId = null, limit = 50 } = {}) {
  let raw;
  try {
    raw = await fsp.readFile(config.AUDIT_LOG_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip a corrupt/truncated line rather than failing the whole read.
      continue;
    }
    if (vmId != null && parsed.vmId !== vmId) continue;
    entries.push(parsed);
  }

  entries.reverse(); // newest first
  return entries.slice(0, limit);
}

module.exports = { logAction, readRecent };
