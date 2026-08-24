'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const config = require('../config/config.json');
const store = require('./store');

// Cloud-init seed ISO builder + template registry.
//
// A "template" is saved cloud-config `user-data` text (with an optional
// {{HOSTNAME}} placeholder). Building an ISO auto-generates `meta-data`
// (instance-id + local-hostname) rather than editing it separately - see
// debian-vm-autoinstall/CLOUD-INIT-EXPLAINED.md (sibling project, same
// mechanism) for why: meta-data is just enough identity for the NoCloud
// datasource to find itself, not something worth hand-editing per build.
//
// Generated ISOs are plain files under CLOUD_INIT_DIR - listed straight off
// the filesystem, not via VBoxManage, since VirtualBox doesn't know about a
// file until it's attached to a VM at least once (see attachMedium in
// lib/vbox.js for that step).

// Computed here rather than centralized, since it depends on where this
// repo was cloned (no JSON equivalent of __dirname) - same convention as
// lib/audit.js's AUDIT_LOG_FILE.
const ROOT_DIR = path.resolve(__dirname, '..');
const CLOUD_INIT_DIR = path.isAbsolute(config.CLOUD_INIT_DIR)
  ? config.CLOUD_INIT_DIR
  : path.join(ROOT_DIR, config.CLOUD_INIT_DIR);
const TEMPLATES_FILE = path.join(ROOT_DIR, 'data', 'cloud-init-templates.json');

const BUILD_TIMEOUT_MS = 15000;

class CloudInitError extends Error {
  constructor(message, { code = 'CLOUD_INIT_ERROR', stderr = '', cause = null } = {}) {
    super(message);
    this.name = 'CloudInitError';
    this.code = code;
    this.stderr = stderr;
    if (cause) this.cause = cause;
  }
}

const NAME_RE = /^[A-Za-z0-9 ._-]{1,64}$/;

const DEFAULT_TEMPLATE = `#cloud-config
hostname: {{HOSTNAME}}
fqdn: {{HOSTNAME}}.local
manage_etc_hosts: true

users:
  - name: debian
    groups: [sudo]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    lock_passwd: true
    ssh_authorized_keys:
      - ssh-ed25519 AAAA... replace-with-your-public-key

ssh_pwauth: false
disable_root: true

package_update: true
package_upgrade: false

growpart:
  mode: auto
  devices: ["/"]
`;

// --- Templates ---

async function listTemplates() {
  return store.readJson(TEMPLATES_FILE, []);
}

async function saveTemplate({ id, name, userData }) {
  if (!NAME_RE.test(name)) {
    throw new CloudInitError(
      'Template name must be 1-64 chars (letters/digits/space/dot/dash/underscore).',
      { code: 'INVALID_NAME' }
    );
  }
  const templates = await listTemplates();
  const templateId = id || crypto.randomUUID();
  const existingIndex = templates.findIndex((t) => t.id === templateId);
  const record = { id: templateId, name, userData, updatedAt: new Date().toISOString() };
  if (existingIndex === -1) {
    templates.push(record);
  } else {
    templates[existingIndex] = record;
  }
  await store.writeJson(TEMPLATES_FILE, templates);
  return record;
}

async function deleteTemplate(id) {
  const templates = await listTemplates();
  const next = templates.filter((t) => t.id !== id);
  await store.writeJson(TEMPLATES_FILE, next);
  return { ok: true };
}

// --- ISO generation ---

function execCloudLocalds(args) {
  return new Promise((resolve, reject) => {
    execFile(
      config.CLOUD_LOCALDS_BIN,
      args,
      { timeout: BUILD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') {
            reject(
              new CloudInitError(
                `cloud-localds binary not found ("${config.CLOUD_LOCALDS_BIN}"). Install cloud-image-utils, or set CLOUD_LOCALDS_BIN in config/config.json.`,
                { code: 'CLOUD_LOCALDS_NOT_FOUND', cause: err }
              )
            );
            return;
          }
          if (err.killed || err.signal === 'SIGTERM') {
            reject(
              new CloudInitError(`cloud-localds timed out after ${BUILD_TIMEOUT_MS}ms`, {
                code: 'CLOUD_LOCALDS_TIMEOUT',
                stderr: String(stderr || ''),
                cause: err,
              })
            );
            return;
          }
          reject(
            new CloudInitError(`cloud-localds failed: ${String(stderr || err.message).trim()}`, {
              code: 'CLOUD_LOCALDS_FAILED',
              stderr: String(stderr || ''),
              cause: err,
            })
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

// Builds a NoCloud seed ISO at <CLOUD_INIT_DIR>/<isoName>.iso from the given
// user-data template text (with {{HOSTNAME}} substituted) and an
// auto-generated meta-data. Rejects if that filename already exists.
async function buildIso({ userData, hostname, isoName }) {
  if (!NAME_RE.test(isoName)) {
    throw new CloudInitError(
      'Output name must be 1-64 chars (letters/digits/space/dot/dash/underscore).',
      { code: 'INVALID_NAME' }
    );
  }
  if (!NAME_RE.test(hostname)) {
    throw new CloudInitError(
      'Hostname must be 1-64 chars (letters/digits/space/dot/dash/underscore).',
      { code: 'INVALID_HOSTNAME' }
    );
  }

  await fsp.mkdir(CLOUD_INIT_DIR, { recursive: true, mode: 0o700 });
  const isoPath = path.join(CLOUD_INIT_DIR, `${isoName}.iso`);

  const alreadyExists = await fsp.access(isoPath).then(
    () => true,
    () => false
  );
  if (alreadyExists) {
    throw new CloudInitError(`${isoName}.iso already exists. Choose a different output name or delete it first.`, {
      code: 'ISO_ALREADY_EXISTS',
    });
  }

  const filledUserData = userData.replace(/\{\{HOSTNAME\}\}/g, hostname);
  const metaData = `instance-id: ${crypto.randomUUID()}\nlocal-hostname: ${hostname}\n`;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nodevboxadmin-cloudinit-'));
  try {
    const userDataFile = path.join(tmpDir, 'user-data');
    const metaDataFile = path.join(tmpDir, 'meta-data');
    await fsp.writeFile(userDataFile, filledUserData, 'utf8');
    await fsp.writeFile(metaDataFile, metaData, 'utf8');
    await execCloudLocalds([isoPath, userDataFile, metaDataFile]);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }

  return { ok: true, path: isoPath, filename: `${isoName}.iso` };
}

async function listIsos() {
  let entries;
  try {
    entries = await fsp.readdir(CLOUD_INIT_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const isos = await Promise.all(
    entries
      .filter((f) => f.toLowerCase().endsWith('.iso'))
      .map(async (filename) => {
        const filePath = path.join(CLOUD_INIT_DIR, filename);
        const stat = await fsp.stat(filePath);
        return { filename, path: filePath, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
      })
  );
  isos.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return isos;
}

// Deletes a generated ISO by filename (not a full path - callers must not
// pass user-controlled paths here). Refuses anything that isn't a plain
// filename inside CLOUD_INIT_DIR.
async function deleteIso(filename) {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new CloudInitError('Invalid ISO filename.', { code: 'INVALID_FILENAME' });
  }
  const filePath = path.join(CLOUD_INIT_DIR, filename);
  await fsp.unlink(filePath);
  return { ok: true };
}

module.exports = {
  CloudInitError,
  CLOUD_INIT_DIR,
  DEFAULT_TEMPLATE,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  buildIso,
  listIsos,
  deleteIso,
};
