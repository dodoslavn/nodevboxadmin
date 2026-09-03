'use strict';

// Dashboard live-status polling + start/stop actions. Vanilla JS, no deps.
// VMs are keyed by their VirtualBox UUID (data-vm-uuid).
//
// User-facing strings are read from data-i18n-* attributes on the
// [data-role="poll-status"] element (rendered by views/dashboard.js, already
// translated server-side via lib/i18n.js) rather than hardcoded here - same
// idiom as public/detail.js.

(function () {
  var POLL_INTERVAL_MS = 5000;
  var tables = document.querySelectorAll('table.vm-table');
  if (!tables.length) return;
  var pollStatus = document.querySelector('[data-role="poll-status"]');

  function i18n(name) {
    return pollStatus ? pollStatus.getAttribute('data-i18n-' + name) || '' : '';
  }

  function badgeClass(state) {
    if (state === 'running') return 'badge badge-running';
    if (state === 'stopped') return 'badge badge-stopped';
    return 'badge badge-unknown';
  }

  function applyStatus(vms) {
    var byUuid = {};
    vms.forEach(function (vm) { byUuid[vm.uuid] = vm; });

    var rows = document.querySelectorAll('table.vm-table tr[data-vm-uuid]');
    rows.forEach(function (row) {
      var vm = byUuid[row.getAttribute('data-vm-uuid')];
      if (!vm) return;

      var badge = row.querySelector('[data-role="state"]');
      if (badge) {
        badge.className = badgeClass(vm.state);
        badge.textContent = vm.state;
      }

      if (row.getAttribute('data-busy') === '1') return;
      var startBtn = row.querySelector('[data-action="start"]');
      var stopBtn = row.querySelector('[data-action="stop"]');
      if (startBtn) startBtn.disabled = vm.running;
      if (stopBtn) stopBtn.disabled = !vm.running;
    });
  }

  function setNotice(text, isError) {
    if (!pollStatus) return;
    pollStatus.textContent = text;
    pollStatus.className = isError ? 'error' : 'muted';
  }

  function poll() {
    return fetch('/api/vms/status', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (res) {
        if (res.status === 401) {
          window.location = '/login';
          throw new Error('unauthorized');
        }
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        applyStatus(data.vms || []);
        if (data.error) {
          setNotice(data.error, true);
        } else {
          setNotice(i18n('live-status-updated') + ' ' + new Date().toLocaleTimeString(), false);
        }
      })
      .catch(function (err) {
        if (err && err.message === 'unauthorized') return;
        setNotice(i18n('could-not-refresh'), true);
      });
  }

  // --- Start/Stop actions ---

  function doAction(row, action) {
    var uuid = row.getAttribute('data-vm-uuid');
    if (!uuid) return;

    if (action === 'stop') {
      if (!window.confirm(i18n('confirm-stop'))) return;
    }

    row.setAttribute('data-busy', '1');
    var buttons = row.querySelectorAll('button[data-action]');
    buttons.forEach(function (b) { b.disabled = true; });
    setNotice((action === 'start' ? i18n('starting') : i18n('stopping')) + '…', false);

    var body = action === 'stop' ? 'mode=acpi' : '';
    fetch('/vms/' + encodeURIComponent(uuid) + '/' + action, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      credentials: 'same-origin',
      body: body,
    })
      .then(function (res) {
        if (res.status === 401) {
          window.location = '/login';
          throw new Error('unauthorized');
        }
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok && data.ok !== false, message: data.message };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          setNotice(i18n('action-failed') + ': ' + (r.message || i18n('unknown-error')), true);
        } else {
          setNotice(action === 'start' ? i18n('start-requested') : i18n('stop-requested'), false);
        }
      })
      .catch(function (err) {
        if (err && err.message === 'unauthorized') return;
        setNotice(i18n('network-error'), true);
      })
      .then(function () {
        row.removeAttribute('data-busy');
        poll();
      });
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('table.vm-table button[data-action]') : null;
    if (!btn || btn.disabled) return;
    var row = btn.closest('tr[data-vm-uuid]');
    if (row) doAction(row, btn.getAttribute('data-action'));
  });

  poll();
  setInterval(poll, POLL_INTERVAL_MS);
})();
