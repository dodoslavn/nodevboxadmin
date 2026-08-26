'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const store = require('./store');
const { runVBoxManage, VBoxError } = require('./vbox');

// VM Templates: a lightweight registry of "this existing VM is a template
// to clone from" (VirtualBox itself has no such concept). Deliberately
// named "VM Templates" everywhere - not to be confused with the unrelated
// cloud-config templates on the Cloud-Init page (lib/cloudinit.js), which
// also happen to be called "templates" but are a different feature.
//
// Only the template VM's UUID (+ an optional note) is persisted - its name
// and whether it still exists are always read live from vbox.listVms(),
// the same cross-referencing approach the Cloud-Init page's mount-to-VM
// picker already uses.

// Computed here rather than centralized, since it depends on where this
// repo was cloned (no JSON equivalent of __dirname) - same convention as
// CLOUD_INIT_DIR/AUDIT_LOG_FILE elsewhere.
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATES_FILE = path.join(ROOT_DIR, 'data', 'vm-templates.json');

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function listMarked() {
  return store.readJson(TEMPLATES_FILE, []);
}

async function mark({ uuid, note = '' }) {
  if (!UUID_RE.test(uuid)) {
    throw new VBoxError('Invalid VM UUID.', { code: 'INVALID_UUID' });
  }
  const templates = await listMarked();
  const existingIndex = templates.findIndex((t) => t.uuid === uuid);
  const record = { uuid, note, markedAt: new Date().toISOString() };
  if (existingIndex === -1) {
    templates.push(record);
  } else {
    templates[existingIndex] = record;
  }
  await store.writeJson(TEMPLATES_FILE, templates);
  return record;
}

async function unmark(uuid) {
  const templates = await listMarked();
  const next = templates.filter((t) => t.uuid !== uuid);
  await store.writeJson(TEMPLATES_FILE, next);
  return { ok: true };
}

// Clones an existing VM (the template) into a new, fully independent VM.
// Full clone (no --options link) - doesn't couple the new VM's disk to the
// template's, so deleting/modifying the template later can't break it.
//
// Unlike `createvm` (which prints "UUID: <uuid>" on success - see
// lib/vbox.js's createVm), `clonevm`'s stdout has no parseable UUID at all,
// just a progress bar and 'Machine has been successfully cloned as "name"'.
// Pre-generating the UUID ourselves and passing --uuid sidesteps output
// parsing entirely - confirmed VirtualBox then uses exactly that UUID for
// the new VM.
async function cloneFromTemplate({ templateUuid, name }) {
  const uuid = crypto.randomUUID();
  await runVBoxManage(['clonevm', templateUuid, '--name', name, '--uuid', uuid, '--register']);
  return { ok: true, uuid, name };
}

module.exports = { listMarked, mark, unmark, cloneFromTemplate };
