'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const config = require('../config/config.json');

// Two configurable folders an admin can point at existing media - not tied
// to any one feature (unlike CLOUD_INIT_DIR, which lib/cloudinit.js both
// writes to and reads from). This module only reads: a plain directory
// scan on each request, not a live watch, despite "library"/"watch" in
// casual usage - same shape as lib/cloudinit.js's listIsos.

// Computed here rather than centralized, since it depends on where this
// repo was cloned (no JSON equivalent of __dirname) - same convention as
// CLOUD_INIT_DIR elsewhere.
const ROOT_DIR = path.resolve(__dirname, '..');

function resolveConfiguredDir(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

const ISO_LIBRARY_DIR = resolveConfiguredDir(config.ISO_LIBRARY_DIR);
const DISK_LIBRARY_DIR = resolveConfiguredDir(config.DISK_LIBRARY_DIR);

// Same extensions lib/vbox.js's DISK_FORMAT_EXTENSIONS already recognizes.
const DISK_EXTENSIONS = ['.vdi', '.vmdk', '.vhd', '.qcow2'];

async function listDirFiles(dir, extensions) {
  if (!dir) return [];
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = await Promise.all(
    entries
      .filter((f) => extensions.includes(path.extname(f).toLowerCase()))
      .map(async (filename) => {
        const filePath = path.join(dir, filename);
        const stat = await fsp.stat(filePath);
        return { filename, path: filePath, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
      })
  );
  files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return files;
}

async function listIsoLibrary() {
  return listDirFiles(ISO_LIBRARY_DIR, ['.iso']);
}

async function listDiskLibrary() {
  return listDirFiles(DISK_LIBRARY_DIR, DISK_EXTENSIONS);
}

module.exports = {
  ISO_LIBRARY_DIR,
  DISK_LIBRARY_DIR,
  listIsoLibrary,
  listDiskLibrary,
};
