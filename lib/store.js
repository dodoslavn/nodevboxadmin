'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

// Safe JSON file storage with a per-file write queue.
//
// Why the queue: even a single admin's browser can fire overlapping requests
// (e.g. dashboard polling while an action POST is in flight). A naive
// read-modify-write on a JSON file can lose writes or, worse, leave a
// truncated/corrupt file if two writes interleave. We serialize writes per
// file and write atomically (temp file + rename) so a crash mid-write never
// corrupts the real file.

const writeChains = new Map(); // absolutePath -> Promise (tail of the queue)

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    if (raw.trim() === '') return fallback;
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function atomicWrite(filePath, data) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const json = JSON.stringify(data, null, 2);
  await fsp.writeFile(tmp, json, { mode: 0o600 });
  await fsp.rename(tmp, filePath);
}

function writeJson(filePath, data) {
  const prev = writeChains.get(filePath) || Promise.resolve();
  // Chain this write after any in-flight write to the same file.
  const next = prev
    .catch(() => {}) // a previous failure shouldn't block later writes
    .then(() => atomicWrite(filePath, data));
  writeChains.set(filePath, next);
  // Clean up the map entry once this is the last write in the chain.
  next.finally(() => {
    if (writeChains.get(filePath) === next) writeChains.delete(filePath);
  });
  return next;
}

module.exports = { readJson, writeJson };
