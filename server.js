'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const APP_CONFIG_FILE = path.join(__dirname, 'config', 'config.json');
if (!fs.existsSync(APP_CONFIG_FILE)) {
  console.error(`ERROR: ${APP_CONFIG_FILE} not found.`);
  console.error('Copy config/config.json.example to config/config.json first.');
  process.exit(1);
}
const config = require('./config/config.json');

// Computed here rather than centralized, since these depend on where this
// repo was cloned (no JSON equivalent of __dirname).
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.log');
const { Router } = require('./lib/router');
const auth = require('./lib/auth');
const vmstatus = require('./lib/vmstatus');
const vbox = require('./lib/vbox');
const cloudinit = require('./lib/cloudinit');
const audit = require('./lib/audit');
const hostinfo = require('./lib/hostinfo');
const { createLimiter } = require('./lib/ratelimit');
const { parseFormBody, redirect, html, json } = require('./lib/http');
const { loginPage } = require('./views/login');
const { dashboardPage } = require('./views/dashboard');
const { vmDetailPage } = require('./views/vmDetail');
const { createVmPage } = require('./views/createVm');
const { hostPage } = require('./views/hostPage');
const { disksPage } = require('./views/disksPage');
const { cloudInitPage } = require('./views/cloudInitPage');
const { networksPage } = require('./views/networksPage');
const {
  editVmPage,
  GFX_CONTROLLERS,
  BOOT_DEVICES,
  CHIPSETS,
  FIRMWARES,
  MOUSE_TYPES,
  KEYBOARD_TYPES,
  CPU_PROFILES,
  PARAVIRT_PROVIDERS,
  VRDE_AUTH_TYPES,
  AUDIO_DRIVERS,
  NIC_ATTACHMENTS,
  NIC_TYPES,
  NIC_COUNT,
  UART_MODES,
  UART_TYPES,
  UART_COUNT,
  CLIPBOARD_MODES,
  DRAGDROP_MODES,
  OS_TYPE_IDS,
  OS_TYPE_ID_BY_LABEL,
} = require('./views/editVm');

// VBoxManage's showvminfo reports the pointing device / keyboard type using
// different tokens than modifyvm accepts as input (e.g. read back
// "ps2mouse", write "--mouse ps2"). Map read-back values to setter values so
// the edit form can preselect the current option.
const POINTING_READBACK = {
  ps2mouse: 'ps2',
  usbmouse: 'usb',
  usbtablet: 'usbtablet',
  usbmultitouch: 'usbmultitouch',
  usbmtscreenpluspad: 'usbmtscreenpluspad',
};
const KEYBOARD_READBACK = { ps2kbd: 'ps2', usbkbd: 'usb' };

const router = new Router();

// --- Rate limiters (M8) ---
const loginLimiter = createLimiter(config.LOGIN_RATE);
const actionLimiter = createLimiter(config.ACTION_RATE);
const screenshotLimiter = createLimiter(config.SCREENSHOT_RATE);

// Derive a client key for rate limiting. Behind a reverse proxy we trust the
// LAST X-Forwarded-For hop: well-behaved proxies (Apache mod_proxy_http,
// nginx, Caddy, ...) append the real client address to any existing header
// rather than replacing it, so a client can prepend arbitrary values of its
// own - only the last entry is the one the proxy itself added and can't be
// spoofed. Otherwise fall back to the socket address. If neither is
// available, all clients share one bucket (fail closed / conservative).
function clientKey(req) {
  if (config.TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const hops = xff.split(',');
      return hops[hops.length - 1].trim();
    }
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Applies a limiter; if exceeded, sends 429 with Retry-After and returns false.
function checkLimit(limiter, req, res, bucket) {
  const r = limiter.hit(`${bucket}:${clientKey(req)}`);
  if (!r.allowed) {
    const retrySec = Math.ceil(r.retryAfterMs / 1000);
    const wantsJson = (req.headers.accept || '').includes('application/json');
    res.writeHead(429, {
      'Content-Type': wantsJson ? 'application/json' : 'text/plain; charset=utf-8',
      'Retry-After': String(retrySec),
    });
    res.end(
      wantsJson
        ? JSON.stringify({ ok: false, message: `Too many requests. Retry in ${retrySec}s.` })
        : `Too many requests. Retry in ${retrySec}s.\n`
    );
    return false;
  }
  return true;
}

// Health check (unauthenticated - used for monitoring/systemd readiness).
router.get('/healthz', (req, res) => {
  json(res, { ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

// Browsers probe this path automatically regardless of the <link rel="icon">
// in layout.js - serve the same icon here so that doesn't 404.
router.get('/favicon.ico', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
  fs.createReadStream(path.join(PUBLIC_DIR, 'favicon.svg')).pipe(res);
});

// Root redirects to dashboard (or login, via the auth guard downstream).
router.get('/', (req, res) => {
  redirect(res, auth.sessionForRequest(req) ? '/dashboard' : '/login');
});

// --- Auth routes (M2) ---

router.get('/login', (req, res) => {
  // Already logged in? Skip the form.
  if (auth.sessionForRequest(req)) {
    redirect(res, '/dashboard');
    return;
  }
  html(res, loginPage());
});

router.post('/login', async (req, res) => {
  if (!checkLimit(loginLimiter, req, res, 'login')) return;
  const body = await parseFormBody(req);
  const username = (body.username || '').trim();
  const password = body.password || '';

  const ok = await auth.verifyLogin(username, password);
  if (!ok) {
    html(res, loginPage({ error: 'Invalid username or password.', username }), 401);
    return;
  }

  // Successful login clears the attempt counter for this client.
  loginLimiter.reset(`login:${clientKey(req)}`);
  const sessionId = auth.createSession();
  redirect(res, '/dashboard', { 'Set-Cookie': auth.sessionCookie(sessionId) });
});

router.post('/logout', (req, res) => {
  const current = auth.sessionForRequest(req);
  if (current) auth.destroySession(current.id);
  redirect(res, '/login', { 'Set-Cookie': auth.sessionCookie('', { clear: true }) });
});

// --- Dashboard: shows ALL VirtualBox VMs (no registry) ---

router.get('/dashboard', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const [{ vms, error }, username] = await Promise.all([vmstatus.getAll(), auth.currentUsername()]);
  html(res, dashboardPage({ vms, username, vboxError: error }));
});

// JSON status endpoint polled by public/app.js. Never cached.
router.get('/api/vms/status', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const { vms, error } = await vmstatus.getAll();
  json(res, { vms, error }, 200, { 'Cache-Control': 'no-store' });
});

// --- Host status: uptime, OS/kernel/VBox version, VBox kernel modules ---

router.get('/host', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const [info, username] = await Promise.all([hostinfo.getHostInfo(), auth.currentUsername()]);
  html(res, hostPage({ info, username }));
});

// --- Virtual media (host-wide - every registered disk/ISO/floppy, not
// scoped to one VM's Storage tab; see lib/vbox.js listAllMedia) ---

const DISK_KINDS = ['disk', 'dvd', 'floppy'];
const DISK_NAME_RE = /^[A-Za-z0-9 ._-]{1,64}$/;

router.get('/disks', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  const query = new URL(req.url, 'http://localhost').searchParams;
  let media = [];
  let error = query.get('error') || '';
  try {
    media = await vbox.listAllMedia();
  } catch (err) {
    error = error || `Could not list virtual media: ${err.message}`;
  }
  html(res, disksPage({ media, diskFormats: vbox.DISK_FORMATS, username, error, notice: query.get('notice') || '' }));
});

router.post('/disks/create', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const folder = (body.folder || '').trim();
  const name = (body.name || '').trim();
  const sizeMB = Math.min(Math.max(parseInt(body.sizeMB, 10) || 20000, 1), 2000000);
  const format = vbox.DISK_FORMATS.includes(body.format) ? body.format : 'VDI';

  if (!folder.startsWith('/') || !DISK_NAME_RE.test(name)) {
    const msg = 'Folder must be an absolute path and name must be 1-64 chars (letters/digits/space/dot/dash/underscore).';
    await audit.logAction({ action: 'disk-create', vmName: null, result: 'error', message: msg, actor: username });
    redirectWithFlash(res, '/disks', { error: msg });
    return;
  }

  try {
    const filename = path.join(folder, `${name}.${vbox.DISK_FORMAT_EXTENSIONS[format]}`);
    await vbox.createDisk({ filename, sizeMB, format });
    await audit.logAction({ action: 'disk-create', vmName: null, result: 'ok', message: `${filename} (${format}, ${sizeMB} MB)`, actor: username });
    redirectWithFlash(res, '/disks', { notice: `Created ${filename}.` });
  } catch (err) {
    await audit.logAction({ action: 'disk-create', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/disks', { error: `Could not create disk: ${err.message}` });
  }
});

// Only deletes media the current listing confirms is unattached - the kind
// and UUID come from the URL (built from that same listing), but we re-check
// server-side rather than trusting the request, since a form field could in
// principle be tampered with.
router.post('/disks/:kind/:uuid/delete', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  const kind = DISK_KINDS.includes(params.kind) ? params.kind : null;

  try {
    if (!kind) throw new vbox.VBoxError(`Invalid medium kind: ${params.kind}`, { code: 'INVALID_KIND' });
    const media = await vbox.listAllMedia();
    const record = media.find((m) => m.kind === kind && m.UUID === params.uuid);
    if (!record) throw new vbox.VBoxError('Medium not found.', { code: 'NOT_FOUND' });
    if (record.inUseByVMs.length) throw new vbox.VBoxError('Still attached to a VM - detach it there first.', { code: 'IN_USE' });
    await vbox.deleteUnattachedMedium(kind, params.uuid);
    await audit.logAction({ action: 'disk-delete', vmName: null, result: 'ok', message: record.Location, actor: username });
    redirectWithFlash(res, '/disks', { notice: `Deleted ${record.Location}.` });
  } catch (err) {
    await audit.logAction({ action: 'disk-delete', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/disks', { error: `Could not delete: ${err.message}` });
  }
});

// Detaches a medium from whichever VM it's currently attached to. The medium
// (by kind+UUID from the URL) and vmUuid (from the form) are both re-checked
// server-side against the actual current state - looking up the real
// controller/port/device to detach from - rather than trusted blindly.
router.post('/disks/:kind/:uuid/detach', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const kind = DISK_KINDS.includes(params.kind) ? params.kind : null;
  const vmUuid = (body.vmUuid || '').trim();

  if (!kind || !vmUuid) {
    redirectWithFlash(res, '/disks', { error: 'Missing VM to detach from.' });
    return;
  }

  try {
    const media = await vbox.listAllMedia();
    const record = media.find((m) => m.kind === kind && m.UUID === params.uuid);
    if (!record) throw new vbox.VBoxError('Medium not found.', { code: 'NOT_FOUND' });

    const info = await vbox.getVmInfo(vmUuid);
    let target = null;
    for (const controller of vbox.parseStorage(info)) {
      const attachment = controller.attachments.find((a) => a.medium === record.Location || a.medium === params.uuid);
      if (attachment) {
        target = { storagectl: controller.name, port: attachment.port, device: attachment.device };
        break;
      }
    }
    if (!target) throw new vbox.VBoxError('Could not find this disk attached on that VM.', { code: 'NOT_ATTACHED' });

    await vbox.attachMedium(vmUuid, { ...target, type: 'hdd', medium: 'none' });
    await audit.logAction({ action: 'disk-detach', vmName: target.storagectl, result: 'ok', message: record.Location, actor: username });
    redirectWithFlash(res, '/disks', { notice: `Detached ${record.Location}.` });
  } catch (err) {
    await audit.logAction({ action: 'disk-detach', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/disks', { error: `Could not detach: ${err.message}` });
  }
});

// --- Cloud-Init (NoCloud seed ISO builder + saved template registry; see
// lib/cloudinit.js. Generated ISOs are plain files, not yet known to
// VirtualBox until attached to a VM - "mounting" one just reuses the
// existing /vms/:uuid/storage/attach route via a pre-filled redirect,
// see public/cloudinit.js) ---

router.get('/cloud-init', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  const query = new URL(req.url, 'http://localhost').searchParams;
  let templates = [];
  let isos = [];
  let vms = [];
  let error = query.get('error') || '';
  try {
    [templates, isos, vms] = await Promise.all([cloudinit.listTemplates(), cloudinit.listIsos(), vbox.listVms()]);
  } catch (err) {
    error = error || `Could not load Cloud-Init page: ${err.message}`;
  }
  html(
    res,
    cloudInitPage({
      templates,
      isos,
      vms,
      defaultTemplate: cloudinit.DEFAULT_TEMPLATE,
      username,
      error,
      notice: query.get('notice') || '',
    })
  );
});

router.post('/cloud-init/templates/save', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const id = (body.id || '').trim() || undefined;
  const name = (body.name || '').trim();
  const userData = body.userData || '';

  try {
    const record = await cloudinit.saveTemplate({ id, name, userData });
    await audit.logAction({ action: 'cloud-init-template-save', vmName: null, result: 'ok', message: record.name, actor: username });
    redirectWithFlash(res, '/cloud-init', { notice: `Saved template "${record.name}".` });
  } catch (err) {
    await audit.logAction({ action: 'cloud-init-template-save', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/cloud-init', { error: `Could not save template: ${err.message}` });
  }
});

router.post('/cloud-init/templates/:id/delete', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    await cloudinit.deleteTemplate(params.id);
    await audit.logAction({ action: 'cloud-init-template-delete', vmName: null, result: 'ok', message: params.id, actor: username });
    redirectWithFlash(res, '/cloud-init', { notice: 'Template deleted.' });
  } catch (err) {
    await audit.logAction({ action: 'cloud-init-template-delete', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/cloud-init', { error: `Could not delete template: ${err.message}` });
  }
});

router.post('/cloud-init/build', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const outputName = (body.outputName || '').trim();
  const userData = body.userData || '';

  try {
    const result = await cloudinit.buildIso({ userData, hostname: outputName, isoName: outputName });
    await audit.logAction({ action: 'cloud-init-build', vmName: null, result: 'ok', message: result.filename, actor: username });
    redirectWithFlash(res, '/cloud-init', { notice: `Generated ${result.filename}.` });
  } catch (err) {
    await audit.logAction({ action: 'cloud-init-build', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/cloud-init', { error: `Could not generate ISO: ${err.message}` });
  }
});

router.post('/cloud-init/isos/:filename/delete', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    await cloudinit.deleteIso(params.filename);
    await audit.logAction({ action: 'cloud-init-iso-delete', vmName: null, result: 'ok', message: params.filename, actor: username });
    redirectWithFlash(res, '/cloud-init', { notice: `Deleted ${params.filename}.` });
  } catch (err) {
    await audit.logAction({ action: 'cloud-init-iso-delete', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/cloud-init', { error: `Could not delete ISO: ${err.message}` });
  }
});

// --- Networks (host-wide - NAT Networks, host-only interfaces, and
// read-only bridged/internal network info; see lib/vbox.js for what this
// VBoxManage build actually supports) ---

const NETWORK_NAME_RE = /^[A-Za-z0-9 ._-]{1,64}$/;
const CIDR_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

router.get('/networks', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  const query = new URL(req.url, 'http://localhost').searchParams;
  let natNetworks = [];
  let hostOnlyIfs = [];
  let bridgedIfs = [];
  let internalNets = [];
  let dhcpServers = [];
  let error = query.get('error') || '';
  try {
    [natNetworks, hostOnlyIfs, bridgedIfs, internalNets, dhcpServers] = await Promise.all([
      vbox.listNatNetworks(),
      vbox.listHostOnlyInterfaces(),
      vbox.listBridgedInterfaces(),
      vbox.listInternalNetworks(),
      vbox.listDhcpServers(),
    ]);
  } catch (err) {
    error = error || `Could not list networks: ${err.message}`;
  }
  const dhcpByInterface = {};
  for (const iface of hostOnlyIfs) {
    const match = dhcpServers.find((d) => d.NetworkName === vbox.dhcpNetworkNameForInterface(iface.Name));
    if (match) dhcpByInterface[iface.Name] = match;
  }
  html(res, networksPage({
    natNetworks, hostOnlyIfs, dhcpByInterface, bridgedIfs, internalNets,
    username, error, notice: query.get('notice') || '',
  }));
});

router.post('/networks/natnet/create', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const name = (body.name || '').trim();
  const network = (body.network || '').trim();
  const dhcp = body.dhcp === 'on';

  if (!NETWORK_NAME_RE.test(name) || !CIDR_RE.test(network)) {
    const msg = 'Name must be 1-64 chars (letters/digits/space/dot/dash/underscore) and network must look like 10.0.2.0/24.';
    await audit.logAction({ action: 'natnet-create', vmName: null, result: 'error', message: msg, actor: username });
    redirectWithFlash(res, '/networks', { error: msg });
    return;
  }

  try {
    await vbox.addNatNetwork({ name, network, dhcp });
    await audit.logAction({ action: 'natnet-create', vmName: null, result: 'ok', message: `${name} (${network})`, actor: username });
    redirectWithFlash(res, '/networks', { notice: `NAT network "${name}" created.` });
  } catch (err) {
    await audit.logAction({ action: 'natnet-create', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/networks', { error: `Could not create NAT network: ${err.message}` });
  }
});

router.post('/networks/natnet/:name/remove', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    await vbox.removeNatNetwork(params.name);
    await audit.logAction({ action: 'natnet-remove', vmName: null, result: 'ok', message: params.name, actor: username });
    redirectWithFlash(res, '/networks', { notice: `NAT network "${params.name}" removed.` });
  } catch (err) {
    await audit.logAction({ action: 'natnet-remove', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/networks', { error: `Could not remove NAT network: ${err.message}` });
  }
});

router.post('/networks/hostonly/create', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    const { name } = await vbox.createHostOnlyInterface();
    await audit.logAction({ action: 'hostonly-create', vmName: null, result: 'ok', message: name, actor: username });
    redirectWithFlash(res, '/networks', { notice: `Host-only interface "${name}" created.` });
  } catch (err) {
    await audit.logAction({ action: 'hostonly-create', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/networks', { error: `Could not create host-only interface: ${err.message}` });
  }
});

router.post('/networks/hostonly/:name/remove', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    await vbox.removeHostOnlyInterface(params.name);
    await audit.logAction({ action: 'hostonly-remove', vmName: null, result: 'ok', message: params.name, actor: username });
    redirectWithFlash(res, '/networks', { notice: `Host-only interface "${params.name}" removed.` });
  } catch (err) {
    await audit.logAction({ action: 'hostonly-remove', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/networks', { error: `Could not remove host-only interface: ${err.message}` });
  }
});

router.post('/networks/hostonly/:name/ipconfig', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const ip = (body.ip || '').trim();
  const netmask = (body.netmask || '').trim();

  if (!IPV4_RE.test(ip) || !IPV4_RE.test(netmask)) {
    redirectWithFlash(res, '/networks', { error: 'IP address and netmask must look like 192.168.56.1.' });
    return;
  }

  try {
    await vbox.configureHostOnlyInterfaceIp(params.name, { ip, netmask });
    await audit.logAction({ action: 'hostonly-ipconfig', vmName: null, result: 'ok', message: `${params.name}: ${ip}/${netmask}`, actor: username });
    redirectWithFlash(res, '/networks', { notice: `Updated IP for "${params.name}".` });
  } catch (err) {
    await audit.logAction({ action: 'hostonly-ipconfig', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/networks', { error: `Could not update IP: ${err.message}` });
  }
});

router.post('/networks/hostonly/:name/dhcp/enable', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const serverIp = (body.serverIp || '').trim();
  const netmask = (body.netmask || '').trim();
  const lowerIp = (body.lowerIp || '').trim();
  const upperIp = (body.upperIp || '').trim();

  if (![serverIp, netmask, lowerIp, upperIp].every((v) => IPV4_RE.test(v))) {
    redirectWithFlash(res, '/networks', { error: 'All DHCP fields must be valid IPv4 addresses.' });
    return;
  }

  try {
    await vbox.addDhcpServer(params.name, { serverIp, netmask, lowerIp, upperIp });
    await audit.logAction({ action: 'hostonly-dhcp-enable', vmName: null, result: 'ok', message: params.name, actor: username });
    redirectWithFlash(res, '/networks', { notice: `DHCP server enabled for "${params.name}".` });
  } catch (err) {
    await audit.logAction({ action: 'hostonly-dhcp-enable', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/networks', { error: `Could not enable DHCP: ${err.message}` });
  }
});

router.post('/networks/hostonly/:name/dhcp/remove', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    await vbox.removeDhcpServer(params.name);
    await audit.logAction({ action: 'hostonly-dhcp-remove', vmName: null, result: 'ok', message: params.name, actor: username });
    redirectWithFlash(res, '/networks', { notice: `DHCP server removed for "${params.name}".` });
  } catch (err) {
    await audit.logAction({ action: 'hostonly-dhcp-remove', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, '/networks', { error: `Could not remove DHCP server: ${err.message}` });
  }
});

// --- Create a new VM ---
// VM name must be simple (letters/digits/space/dash/underscore/dot) - both a
// VBox-friendliness and defense-in-depth measure (execFile already prevents
// shell injection).
const VM_NAME_RE = /^[A-Za-z0-9 ._-]{1,64}$/;

router.get('/vms/new', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  html(res, createVmPage({ username }));
});

router.post('/vms/new', async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const name = (body.name || '').trim();
  const memoryMB = Math.min(Math.max(parseInt(body.memoryMB, 10) || 2048, 4), 131072);
  const cpus = Math.min(Math.max(parseInt(body.cpus, 10) || 1, 1), 64);
  const username = await auth.currentUsername();

  if (!VM_NAME_RE.test(name)) {
    html(
      res,
      createVmPage({ username, error: 'VM name must be 1-64 chars: letters, digits, space, dot, dash, underscore.', form: body }),
      400
    );
    return;
  }

  try {
    await vbox.createVm({ name, memoryMB, cpus });
    await audit.logAction({ action: 'create', vmName: name, result: 'ok', actor: username });
    redirect(res, '/dashboard');
  } catch (err) {
    await audit.logAction({ action: 'create', vmName: name, result: 'error', message: err.message, actor: username });
    html(res, createVmPage({ username, error: `Could not create VM: ${err.message}`, form: body }), 502);
  }
});

// --- VM actions (start/stop) ---
// VMs are addressed by their VirtualBox UUID. The UUID from the URL is passed
// to VBoxManage via execFile (array args, no shell) so it cannot inject. We
// resolve the VM's name for nicer audit logs, tolerating lookup failure.

function wantsJson(req) {
  return (req.headers.accept || '').includes('application/json');
}

// Storage/USB/shared-folder actions on the Edit page are each their own
// immediate POST + redirect (see comment above the Storage routes below) -
// there's no form re-render to carry an error/notice on directly like the
// main settings form's rerender() does. Round-tripping the message through a
// query string on the redirect (a classic "flash message") lets the GET
// handler show it after the redirect, instead of failures being logged to
// the audit trail but never actually shown to whoever clicked the button.
function redirectWithFlash(res, path, { error, notice } = {}) {
  const qs = new URLSearchParams();
  if (error) qs.set('error', error);
  if (notice) qs.set('notice', notice);
  const suffix = qs.toString();
  redirect(res, suffix ? `${path}?${suffix}` : path);
}

function respondAction(req, res, { ok, status, message }) {
  if (wantsJson(req)) {
    json(res, { ok, message }, status);
  } else {
    redirect(res, '/dashboard');
  }
}

async function vmNameFor(uuid) {
  try {
    const info = await vbox.getVmInfo(uuid);
    return info.name || uuid;
  } catch {
    return uuid;
  }
}

async function runVmAction(req, res, uuid, { action, run }) {
  const actor = await auth.currentUsername();
  const vmName = await vmNameFor(uuid);
  try {
    const result = await run(uuid);
    await audit.logAction({ action, vmName, result: 'ok', actor });
    respondAction(req, res, { ok: true, status: 200, message: result.message });
  } catch (err) {
    await audit.logAction({ action, vmName, result: 'error', message: err.message, actor });
    respondAction(req, res, { ok: false, status: 502, message: err.message });
  }
}

router.post('/vms/:uuid/start', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  if (!checkLimit(actionLimiter, req, res, 'action')) return;
  await parseFormBody(req); // drain body
  await runVmAction(req, res, params.uuid, {
    action: 'start',
    run: (uuid) => vbox.startVm(uuid),
  });
});

router.post('/vms/:uuid/stop', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  if (!checkLimit(actionLimiter, req, res, 'action')) return;
  const body = await parseFormBody(req);
  const mode = body.mode === 'hard' ? 'hard' : 'acpi';
  await runVmAction(req, res, params.uuid, {
    action: mode === 'hard' ? 'stop-hard' : 'stop',
    run: (uuid) => vbox.stopVm(uuid, mode),
  });
});

// Delete a VM from VirtualBox entirely (unregister + delete files).
router.post('/vms/:uuid/delete', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const actor = await auth.currentUsername();
  const vmName = await vmNameFor(params.uuid);
  try {
    await vbox.deleteVm(params.uuid);
    await audit.logAction({ action: 'delete', vmName, result: 'ok', actor });
  } catch (err) {
    await audit.logAction({ action: 'delete', vmName, result: 'error', message: err.message, actor });
  }
  redirect(res, '/dashboard');
});

// --- Edit a VM's settings (name, memory, cpus) ---

router.get('/vms/:uuid/edit', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  const query = new URL(req.url, 'http://localhost').searchParams;
  const flashError = query.get('error') || '';
  const flashNotice = query.get('notice') || '';
  try {
    const info = await vbox.getVmInfo(params.uuid);
    const vm = {
      uuid: params.uuid,
      name: info.name || '',
      description: info.description || '',
      ostype: OS_TYPE_ID_BY_LABEL[info.ostype] || '',
      memoryMB: info.memory || '',
      cpus: info.cpus || '',
      vram: info.vram || '',
      graphicscontroller: info.graphicscontroller || '',
      boot1: info.boot1 || 'none',
      boot2: info.boot2 || 'none',
      boot3: info.boot3 || 'none',
      boot4: info.boot4 || 'none',
      chipset: info.chipset || '',
      firmware: (info.firmware || '').toLowerCase(),
      mouse: POINTING_READBACK[info.hidpointing] || '',
      keyboard: KEYBOARD_READBACK[info.hidkeyboard] || '',
      acpi: info.acpi === 'on',
      ioapic: info.ioapic === 'on',
      pae: info.pae === 'on',
      rtcuseutc: info.rtcuseutc === 'on',
      cpuexecutioncap: info.cpuexecutioncap || '100',
      cpuprofile: info['cpu-profile'] || 'host',
      nestedhwvirt: info['nested-hw-virt'] === 'on',
      hwvirtex: info.hwvirtex === 'on',
      nestedpaging: info.nestedpaging === 'on',
      largepages: info.largepages === 'on',
      paravirtprovider: info.paravirtprovider || 'default',
      monitorcount: info.monitorcount || '1',
      accelerate3d: info.accelerate3d === 'on',
      vrde: info.vrde === 'on',
      // VBox only reports vrdeports/vrdeauthtype while VRDE is enabled; fall
      // back to its own defaults so the form has sane values either way.
      vrdeport: (info.vrdeports || '3389').split(/[,-]/)[0],
      vrdeauthtype: info.vrdeauthtype || 'null',
      recording: info.recording_enabled === 'on',
      recordingres: info.rec_screen_video_res_xy || '',
      recordingfps: info.rec_screen_video_fps || '',
      // VBox folds "enabled" into the driver readback ("none" = disabled);
      // the real driver choice underneath is preserved even while disabled,
      // it's just not visible here, so fall back to 'default' when hidden.
      audioenabled: info.audio !== 'none',
      audiodriver: (info.audio && info.audio !== 'none') ? info.audio : 'default',
      audioin: info.audio_in === 'on',
      audioout: info.audio_out === 'on',
      nics: vbox.parseNics(info, NIC_COUNT),
      uarts: vbox.parseUarts(info, UART_COUNT),
      usbohci: info.usb === 'on',
      usbehci: info.ehci === 'on',
      usbxhci: info.xhci === 'on',
      usbFilters: vbox.parseUsbFilters(info),
      sharedFolders: vbox.parseSharedFolders(info),
      clipboardmode: info.clipboard || 'disabled',
      clipboardfiletransfers: info.clipboard_file_transfers === 'on',
      draganddrop: info.draganddrop || 'disabled',
      snapshotfolder: info.SnapFldr || '',
      autostartenabled: info['autostart-enabled'] === 'on',
      autostartdelay: info['autostart-delay'] || '0',
    };
    const storage = vbox.parseStorage(info);
    html(res, editVmPage({
      vm, username, storage, storageBuses: vbox.STORAGE_BUSES, diskFormats: vbox.DISK_FORMATS,
      busPortRanges: vbox.BUS_PORT_RANGE, error: flashError, notice: flashNotice,
      attachIso: query.get('attachIso') || '',
    }));
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p>VM not found. <a href="/dashboard">Back</a></p>');
  }
});

router.post('/vms/:uuid/edit', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();

  const name = (body.name || '').trim();
  const memoryMB = Math.min(Math.max(parseInt(body.memoryMB, 10) || 0, 4), 131072);
  const cpus = Math.min(Math.max(parseInt(body.cpus, 10) || 0, 1), 64);
  const vram = Math.min(Math.max(parseInt(body.vram, 10) || 0, 1), 256);
  const description = (body.description || '').slice(0, 255);
  const ostype = OS_TYPE_IDS.includes(body.ostype) ? body.ostype : '';
  // Validate select values against known-good lists (defense in depth).
  const graphicscontroller = GFX_CONTROLLERS.includes(body.graphicscontroller) ? body.graphicscontroller : '';
  const boot1 = BOOT_DEVICES.includes(body.boot1) ? body.boot1 : '';
  const boot2 = BOOT_DEVICES.includes(body.boot2) ? body.boot2 : '';
  const boot3 = BOOT_DEVICES.includes(body.boot3) ? body.boot3 : '';
  const boot4 = BOOT_DEVICES.includes(body.boot4) ? body.boot4 : '';
  const chipset = CHIPSETS.includes(body.chipset) ? body.chipset : '';
  const firmware = FIRMWARES.includes(body.firmware) ? body.firmware : '';
  const mouse = MOUSE_TYPES.includes(body.mouse) ? body.mouse : '';
  const keyboard = KEYBOARD_TYPES.includes(body.keyboard) ? body.keyboard : '';
  const cpuprofile = CPU_PROFILES.includes(body.cpuprofile) ? body.cpuprofile : '';
  const cpuexecutioncap = Math.min(Math.max(parseInt(body.cpuexecutioncap, 10) || 100, 1), 100);
  const paravirtprovider = PARAVIRT_PROVIDERS.includes(body.paravirtprovider) ? body.paravirtprovider : '';
  const monitorcount = Math.min(Math.max(parseInt(body.monitorcount, 10) || 1, 1), 8);
  const vrdeport = body.vrdeport ? Math.min(Math.max(parseInt(body.vrdeport, 10) || 3389, 1), 65535) : '';
  const vrdeauthtype = VRDE_AUTH_TYPES.includes(body.vrdeauthtype) ? body.vrdeauthtype : '';
  const recordingres = (body.recordingres || '').trim();
  const recordingfps = body.recordingfps ? Math.min(Math.max(parseInt(body.recordingfps, 10) || 25, 1), 60) : '';
  const RECORDING_RES_RE = /^\d{2,5}x\d{2,5}$/;
  const audiodriver = AUDIO_DRIVERS.includes(body.audiodriver) ? body.audiodriver : '';
  // Checkboxes: present = 'on', absent = 'off'.
  const acpi = body.acpi === 'on' ? 'on' : 'off';
  const ioapic = body.ioapic === 'on' ? 'on' : 'off';
  const pae = body.pae === 'on' ? 'on' : 'off';
  const rtcuseutc = body.rtcuseutc === 'on' ? 'on' : 'off';
  const nestedhwvirt = body.nestedhwvirt === 'on' ? 'on' : 'off';
  const hwvirtex = body.hwvirtex === 'on' ? 'on' : 'off';
  const nestedpaging = body.nestedpaging === 'on' ? 'on' : 'off';
  const largepages = body.largepages === 'on' ? 'on' : 'off';
  const accelerate3d = body.accelerate3d === 'on' ? 'on' : 'off';
  const vrde = body.vrde === 'on' ? 'on' : 'off';
  const recording = body.recording === 'on' ? 'on' : 'off';
  const audioenabled = body.audioenabled === 'on' ? 'on' : 'off';
  const audioin = body.audioin === 'on' ? 'on' : 'off';
  const audioout = body.audioout === 'on' ? 'on' : 'off';
  const MAC_RE = /^[0-9A-Fa-f]{12}$/;
  let nicError = '';
  const nics = [];
  for (let n = 1; n <= NIC_COUNT; n++) {
    const attachment = NIC_ATTACHMENTS.includes(body[`nic${n}attachment`]) ? body[`nic${n}attachment`] : 'none';
    const nictype = NIC_TYPES.includes(body[`nic${n}type`]) ? body[`nic${n}type`] : '';
    const macaddress = (body[`nic${n}mac`] || '').trim();
    const target = (body[`nic${n}target`] || '').trim().slice(0, 64);
    const cableconnected = body[`nic${n}cable`] === 'on' ? 'on' : 'off';
    if (macaddress && macaddress !== 'auto' && !MAC_RE.test(macaddress)) {
      nicError = `Adapter ${n}: MAC address must be "auto" or 12 hex digits.`;
    }
    nics.push({ index: n, attachment, nictype, macaddress, target, cableconnected });
  }
  const IOBASE_RE = /^0x[0-9A-Fa-f]{1,4}$/;
  let uartError = '';
  const uarts = [];
  for (let n = 1; n <= UART_COUNT; n++) {
    const enabled = body[`uart${n}enabled`] === 'on';
    const iobase = (body[`uart${n}iobase`] || '').trim();
    const irq = body[`uart${n}irq`] !== undefined ? Math.min(Math.max(parseInt(body[`uart${n}irq`], 10) || 0, 0), 15) : '';
    const uarttype = UART_TYPES.includes(body[`uart${n}type`]) ? body[`uart${n}type`] : '16550A';
    const mode = UART_MODES.includes(body[`uart${n}mode`]) ? body[`uart${n}mode`] : 'disconnected';
    const target = (body[`uart${n}target`] || '').trim().slice(0, 128);
    if (enabled) {
      if (!IOBASE_RE.test(iobase)) {
        uartError = `Serial port ${n}: I/O base must look like 0x3F8.`;
      } else if (mode !== 'disconnected' && !target) {
        uartError = `Serial port ${n}: this mode needs a path/port/host:port value.`;
      }
    }
    uarts.push({ index: n, enabled, iobase, irq, uarttype, mode, target });
  }
  const usbohci = body.usbohci === 'on' ? 'on' : 'off';
  const usbehci = body.usbehci === 'on' ? 'on' : 'off';
  const usbxhci = body.usbxhci === 'on' ? 'on' : 'off';
  const clipboardmode = CLIPBOARD_MODES.includes(body.clipboardmode) ? body.clipboardmode : 'disabled';
  const draganddrop = DRAGDROP_MODES.includes(body.draganddrop) ? body.draganddrop : 'disabled';
  // VBoxManage's own vocabulary for this one flag is enabled/disabled, not
  // on/off (confirmed by testing) - translate the checkbox here.
  const clipboardfiletransfers = body.clipboardfiletransfers === 'on' ? 'enabled' : 'disabled';
  const snapshotfolder = (body.snapshotfolder || 'default').trim().slice(0, 255) || 'default';
  const autostartenabled = body.autostartenabled === 'on' ? 'on' : 'off';
  const autostartdelay = Math.min(Math.max(parseInt(body.autostartdelay, 10) || 0, 0), 3600);

  const rerender = (error) => {
    const vm = {
      uuid: params.uuid, name, description, ostype, memoryMB, cpus, vram,
      graphicscontroller, boot1, boot2, boot3, boot4, chipset, firmware, mouse, keyboard,
      cpuexecutioncap, cpuprofile, paravirtprovider,
      acpi: acpi === 'on', ioapic: ioapic === 'on', pae: pae === 'on', rtcuseutc: rtcuseutc === 'on',
      nestedhwvirt: nestedhwvirt === 'on', hwvirtex: hwvirtex === 'on',
      nestedpaging: nestedpaging === 'on', largepages: largepages === 'on',
      monitorcount, vrdeport, vrdeauthtype, recordingres, recordingfps, audiodriver,
      accelerate3d: accelerate3d === 'on', vrde: vrde === 'on', recording: recording === 'on',
      audioenabled: audioenabled === 'on', audioin: audioin === 'on', audioout: audioout === 'on',
      nics: nics.map((nic) => ({ ...nic, cableconnected: nic.cableconnected === 'on' })),
      uarts,
      usbohci: usbohci === 'on', usbehci: usbehci === 'on', usbxhci: usbxhci === 'on',
      clipboardmode, draganddrop, snapshotfolder, autostartdelay,
      clipboardfiletransfers: clipboardfiletransfers === 'enabled', autostartenabled: autostartenabled === 'on',
    };
    html(res, editVmPage({ vm, username, error }), 400);
  };

  if (!VM_NAME_RE.test(name)) {
    return rerender('VM name must be 1-64 chars: letters, digits, space, dot, dash, underscore.');
  }
  if (recordingres && !RECORDING_RES_RE.test(recordingres)) {
    return rerender('Recording resolution must look like 1024x768.');
  }
  if (nicError) {
    return rerender(nicError);
  }
  if (uartError) {
    return rerender(uartError);
  }

  try {
    await vbox.modifyVm(params.uuid, {
      name, description, ostype, memoryMB, cpus, vram,
      graphicscontroller, boot1, boot2, boot3, boot4, chipset, firmware, mouse, keyboard,
      acpi, ioapic, pae, rtcuseutc, cpuexecutioncap, cpuprofile, nestedhwvirt,
      hwvirtex, nestedpaging, largepages, paravirtprovider,
      monitorcount, accelerate3d, vrde, vrdeport, vrdeauthtype,
      recording, recordingres, recordingfps,
      audioenabled, audiodriver, audioin, audioout,
      clipboardmode, clipboardfiletransfers, draganddrop, snapshotfolder,
    });
    await vbox.configureNics(params.uuid, nics);
    await vbox.configureUarts(params.uuid, uarts);
    await vbox.configureUsb(params.uuid, { ohci: usbohci, ehci: usbehci, xhci: usbxhci });
    await audit.logAction({ action: 'modify', vmName: name, result: 'ok', actor: username });
  } catch (err) {
    await audit.logAction({ action: 'modify', vmName: name, result: 'error', message: err.message, actor: username });
    return rerender(`Could not save changes: ${err.message}`);
  }

  // Autostart is applied as its own call, deliberately isolated from the
  // batch above: it fails hard on any host without an autostart database
  // configured, and modifyvm applies its flags atomically, so bundling it in
  // would let that one unrelated failure roll back everything else too (see
  // lib/vbox.js). A failure here is logged but doesn't block the redirect -
  // the rest of the save already succeeded.
  try {
    await vbox.configureAutostart(params.uuid, { enabled: autostartenabled, delaySeconds: autostartdelay });
    await audit.logAction({ action: 'modify-autostart', vmName: name, result: 'ok', actor: username });
  } catch (err) {
    await audit.logAction({ action: 'modify-autostart', vmName: name, result: 'error', message: err.message, actor: username });
  }
  redirect(res, `/vms/${encodeURIComponent(params.uuid)}`);
});

// --- VM detail + screenshot ---

router.get('/vms/:uuid/screenshot.png', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  if (!checkLimit(screenshotLimiter, req, res, 'screenshot')) return;
  try {
    const png = await vbox.screenshot(params.uuid);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(png);
  } catch (err) {
    let status = 409;
    if (err instanceof vbox.VBoxError) {
      if (err.code === 'VBOXMANAGE_NOT_FOUND') status = 503;
      else if (err.code === 'VBOXMANAGE_TIMEOUT') status = 504;
    }
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Screenshot unavailable (is the VM running?)\n');
  }
});

router.get('/vms/:uuid', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const uuid = params.uuid;
  const username = await auth.currentUsername();

  let status = { present: false, state: 'unknown', running: false };
  let info = null;
  let error = '';
  let vm = { uuid, displayName: uuid, vboxUuid: uuid };
  try {
    info = await vbox.getVmInfo(uuid);
    const state = info.VMState || 'unknown';
    status = { present: true, state, running: state === 'running' };
    vm = { uuid, displayName: info.name || uuid, vboxUuid: uuid };
  } catch (err) {
    if (err instanceof vbox.VBoxError && err.code === 'VM_NOT_FOUND') {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>VM not found. <a href="/dashboard">Back</a></p>');
      return;
    }
    error = `Could not query VirtualBox: ${err.message}`;
  }

  // Audit history for this VM, filtered by name.
  const vmHistory = (await audit.readRecent({ limit: 200 })).filter(
    (e) => e.vmName === (info && info.name)
  ).slice(0, 25);

  const storage = info ? vbox.parseStorage(info) : [];

  html(res, vmDetailPage({
    vm, status, info, history: vmHistory, username, error,
    storage, storageBuses: vbox.STORAGE_BUSES,
  }));
});

// --- Storage: controllers, disk/ISO attach ---
// Unlike modifyvm-backed settings, each of these is its own immediate
// VBoxManage call (no batched "Save changes" form) - same pattern as
// start/stop/delete above.

const STORAGE_CTL_NAME_RE = /^[A-Za-z0-9 ._-]{1,32}$/;
const STORAGE_TYPES = ['hdd', 'dvddrive', 'fdd'];

router.post('/vms/:uuid/storage/controllers', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const name = (body.name || '').trim();
  const bus = vbox.STORAGE_BUSES.includes(body.bus) ? body.bus : '';
  const portCount = Math.min(Math.max(parseInt(body.portCount, 10) || 4, 1), 30);

  if (!STORAGE_CTL_NAME_RE.test(name) || !bus) {
    const msg = 'Controller name must be 1-32 chars (letters/digits/space/dot/dash/underscore) and a bus must be chosen.';
    await audit.logAction({ action: 'storage-add-controller', vmName: name, result: 'error', message: msg, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: msg });
    return;
  }

  try {
    await vbox.addStorageController(params.uuid, { name, bus, portCount });
    await audit.logAction({ action: 'storage-add-controller', vmName: name, result: 'ok', actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: `Controller "${name}" added.` });
  } catch (err) {
    await audit.logAction({ action: 'storage-add-controller', vmName: name, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not add controller: ${err.message}` });
  }
});

router.post('/vms/:uuid/storage/controllers/:name/remove', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    await vbox.removeStorageController(params.uuid, params.name);
    await audit.logAction({ action: 'storage-remove-controller', vmName: params.name, result: 'ok', actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: `Controller "${params.name}" removed.` });
  } catch (err) {
    await audit.logAction({ action: 'storage-remove-controller', vmName: params.name, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not remove controller: ${err.message}` });
  }
});

router.post('/vms/:uuid/storage/attach', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const storagectl = (body.storagectl || '').trim();
  const port = Math.min(Math.max(parseInt(body.port, 10) || 0, 0), 29);
  const device = body.device === '1' ? 1 : 0;
  const type = STORAGE_TYPES.includes(body.type) ? body.type : 'hdd';
  const medium = (body.medium || '').trim() || 'none';

  if (!storagectl) {
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: 'No storage controller specified.' });
    return;
  }

  try {
    await vbox.attachMedium(params.uuid, { storagectl, port, device, type, medium });
    await audit.logAction({ action: 'storage-attach', vmName: storagectl, result: 'ok', message: `port ${port} device ${device}: ${medium}`, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: medium === 'none' ? 'Detached.' : `Attached ${medium}.` });
  } catch (err) {
    await audit.logAction({ action: 'storage-attach', vmName: storagectl, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not attach/detach: ${err.message}` });
  }
});

// Permanently deletes an attached disk's underlying file from the host (not
// just detaching it). The medium to delete is looked up server-side from the
// VM's current storage config by storagectl+port+device - never taken from
// the request body - so a tampered form can't be used to point VBoxManage's
// --delete at an arbitrary path.
router.post('/vms/:uuid/storage/delete-disk', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const storagectl = (body.storagectl || '').trim();
  const port = Math.min(Math.max(parseInt(body.port, 10) || 0, 0), 29);
  const device = body.device === '1' ? 1 : 0;

  if (!storagectl) {
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: 'No storage controller specified.' });
    return;
  }

  try {
    const info = await vbox.getVmInfo(params.uuid);
    const controller = vbox.parseStorage(info).find((c) => c.name === storagectl);
    const attachment = controller && controller.attachments.find((a) => a.port === port && a.device === device);
    const medium = attachment && attachment.medium;
    if (!medium || medium === 'none' || medium === 'emptydrive') {
      throw new vbox.VBoxError('Nothing attached at that port/device.', { code: 'NO_MEDIUM' });
    }
    await vbox.deleteAttachedMedium(params.uuid, { storagectl, port, device, medium });
    await audit.logAction({ action: 'storage-delete-disk', vmName: storagectl, result: 'ok', message: medium, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: `Deleted ${medium}.` });
  } catch (err) {
    await audit.logAction({ action: 'storage-delete-disk', vmName: storagectl, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not delete disk: ${err.message}` });
  }
});

router.post('/vms/:uuid/storage/disks', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const storagectl = (body.storagectl || '').trim();
  const port = Math.min(Math.max(parseInt(body.port, 10) || 0, 0), 29);
  const device = body.device === '1' ? 1 : 0;
  const diskname = (body.diskname || '').trim();
  const sizeMB = Math.min(Math.max(parseInt(body.sizeMB, 10) || 20000, 1), 2000000);
  const format = vbox.DISK_FORMATS.includes(body.format) ? body.format : 'VDI';

  if (!storagectl || !VM_NAME_RE.test(diskname)) {
    const msg = 'Disk name must be 1-64 chars (letters/digits/space/dot/dash/underscore) and a controller must be specified.';
    await audit.logAction({ action: 'storage-create-disk', vmName: storagectl, result: 'error', message: msg, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: msg });
    return;
  }

  try {
    const info = await vbox.getVmInfo(params.uuid);
    const vmDir = path.dirname(info.CfgFile);
    const filename = path.join(vmDir, `${diskname}.${vbox.DISK_FORMAT_EXTENSIONS[format]}`);
    const { uuid: diskUuid } = await vbox.createDisk({ filename, sizeMB, format });
    await vbox.attachMedium(params.uuid, { storagectl, port, device, type: 'hdd', medium: diskUuid });
    await audit.logAction({ action: 'storage-create-disk', vmName: storagectl, result: 'ok', message: `${path.basename(filename)} (${format}, ${sizeMB} MB) at port ${port} device ${device}`, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: `Created and attached ${path.basename(filename)}.` });
  } catch (err) {
    await audit.logAction({ action: 'storage-create-disk', vmName: storagectl, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not create disk: ${err.message}` });
  }
});

// --- USB device filters (add/remove only - see lib/vbox.js on why there's
// no in-place edit) ---

const USB_FILTER_ACTIONS = ['hold', 'ignore'];
const HEX_ID_RE = /^[0-9A-Fa-f]{1,4}$/;

router.post('/vms/:uuid/usb/filters', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const name = (body.name || '').trim().slice(0, 64);
  const action = USB_FILTER_ACTIONS.includes(body.action) ? body.action : 'hold';
  const vendorid = (body.vendorid || '').trim();
  const productid = (body.productid || '').trim();
  const manufacturer = (body.manufacturer || '').trim().slice(0, 64);
  const product = (body.product || '').trim().slice(0, 64);
  const serialnumber = (body.serialnumber || '').trim().slice(0, 64);

  if (!name || (vendorid && !HEX_ID_RE.test(vendorid)) || (productid && !HEX_ID_RE.test(productid))) {
    const msg = 'Filter needs a name; vendor/product ID (if given) must be 1-4 hex digits.';
    await audit.logAction({ action: 'usb-add-filter', vmName: name, result: 'error', message: msg, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: msg });
    return;
  }

  try {
    const info = await vbox.getVmInfo(params.uuid);
    const nextIndex = vbox.parseUsbFilters(info).length;
    await vbox.addUsbFilter(params.uuid, nextIndex, { name, action, vendorid, productid, manufacturer, product, serialnumber });
    await audit.logAction({ action: 'usb-add-filter', vmName: name, result: 'ok', actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: `USB filter "${name}" added.` });
  } catch (err) {
    await audit.logAction({ action: 'usb-add-filter', vmName: name, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not add USB filter: ${err.message}` });
  }
});

router.post('/vms/:uuid/usb/filters/:index/remove', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  const oneBasedIndex = parseInt(params.index, 10);
  try {
    if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) {
      throw new vbox.VBoxError(`Invalid filter index: ${params.index}`, { code: 'INVALID_INDEX' });
    }
    await vbox.removeUsbFilter(params.uuid, oneBasedIndex - 1);
    await audit.logAction({ action: 'usb-remove-filter', vmName: null, result: 'ok', actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: 'USB filter removed.' });
  } catch (err) {
    await audit.logAction({ action: 'usb-remove-filter', vmName: null, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not remove USB filter: ${err.message}` });
  }
});

// --- Shared Folders (add/remove only - see lib/vbox.js on why) ---

const SHARE_NAME_RE = /^[A-Za-z0-9 ._-]{1,64}$/;

router.post('/vms/:uuid/sharedfolders', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const body = await parseFormBody(req);
  const username = await auth.currentUsername();
  const name = (body.name || '').trim();
  const hostpath = (body.hostpath || '').trim().slice(0, 255);
  const readonly = body.readonly === 'on';
  const automount = body.automount === 'on';

  if (!SHARE_NAME_RE.test(name) || !hostpath) {
    const msg = 'Folder name must be 1-64 chars (letters/digits/space/dot/dash/underscore) and a host path is required.';
    await audit.logAction({ action: 'sharedfolder-add', vmName: name, result: 'error', message: msg, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: msg });
    return;
  }

  try {
    await vbox.addSharedFolder(params.uuid, { name, hostpath, readonly, automount });
    await audit.logAction({ action: 'sharedfolder-add', vmName: name, result: 'ok', actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: `Shared folder "${name}" added.` });
  } catch (err) {
    await audit.logAction({ action: 'sharedfolder-add', vmName: name, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not add shared folder: ${err.message}` });
  }
});

router.post('/vms/:uuid/sharedfolders/:name/remove', async (req, res, params) => {
  if (!auth.requireAuth(req, res)) return;
  const username = await auth.currentUsername();
  try {
    await vbox.removeSharedFolder(params.uuid, params.name);
    await audit.logAction({ action: 'sharedfolder-remove', vmName: params.name, result: 'ok', actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { notice: `Shared folder "${params.name}" removed.` });
  } catch (err) {
    await audit.logAction({ action: 'sharedfolder-remove', vmName: params.name, result: 'error', message: err.message, actor: username });
    redirectWithFlash(res, `/vms/${encodeURIComponent(params.uuid)}/edit`, { error: `Could not remove shared folder: ${err.message}` });
  }
});

// --- Static file serving for /public/* ---
// No static-file library dependency; this is small and safe enough to
// hand-roll (path traversal guarded by resolving + prefix-checking against
// PUBLIC_DIR).
const MIME_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function tryServeStatic(pathname, res) {
  if (!pathname.startsWith('/public/')) return false;

  const relative = pathname.slice('/public/'.length);
  const resolved = path.resolve(PUBLIC_DIR, relative);

  // Guard against path traversal (e.g. /public/../../etc/passwd).
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return false;
  }

  const ext = path.extname(resolved);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

// --- Request handling ---
function handleRequest(req, res) {
  // Parse only the path/query. Do NOT build a URL from the Host header:
  // a malformed Host header would otherwise throw here and (since this runs
  // outside the async try/catch) crash the process - a trivial remote DoS.
  // req.url is always a valid origin-form path for HTTP/1.x requests.
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request\n');
    return;
  }

  // Treat HEAD like GET for routing/static (Node strips the body on HEAD
  // responses automatically), so health checks / monitoring HEAD requests work.
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  try {
    if (method === 'GET' && tryServeStatic(pathname, res)) return;

    const match = router.match(method, pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found\n');
      return;
    }

    Promise.resolve(match.handler(req, res, match.params)).catch((err) => {
      handleError(err, res);
    });
  } catch (err) {
    // Synchronous throw from a handler or static server.
    handleError(err, res);
  }
}

// Central error responder. Never lets one bad request crash the process.
function handleError(err, res) {
  // Honor an error-carried statusCode (e.g. 413 for oversized bodies);
  // otherwise treat as an unexpected 500.
  const status = Number.isInteger(err && err.statusCode) ? err.statusCode : 500;
  if (status >= 500) {
    console.error('Unhandled error in route handler:', err);
  }
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(status === 413 ? 'Request too large\n' : 'Internal server error\n');
  }
}

const server = http.createServer(handleRequest);

// Ensure the data directory exists with restrictive permissions before we
// start serving. config.json holds the admin password hash, so this dir must
// not be world/group readable. Best-effort: log but don't crash if chmod
// fails (e.g. unusual ownership).
function ensureDataDirPerms() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(DATA_DIR, 0o700);
    for (const f of [CONFIG_FILE, AUDIT_LOG_FILE]) {
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    }
  } catch (err) {
    console.warn('Warning: could not enforce data/ permissions:', err.message);
  }
}
ensureDataDirPerms();

auth.startSessionSweeper();
loginLimiter.startSweeper();
actionLimiter.startSweeper();
screenshotLimiter.startSweeper();

server.listen(config.PORT, config.HOST, () => {
  console.log(`nodevboxadmin listening on http://${config.HOST}:${config.PORT}`);
});

// Graceful shutdown for systemd (Restart=on-failure + clean stop on SIGTERM).
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
  // Force-exit if close() hangs (e.g. a stuck keep-alive connection).
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Last-resort safety net. Per-request errors are already handled above; these
// catch anything truly unexpected. Log loudly. An unhandledRejection is not
// fatal here, but an uncaughtException leaves the process in an unknown state,
// so we exit and let systemd restart cleanly (Restart=on-failure).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, exiting for restart:', err);
  process.exit(1);
});
