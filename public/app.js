'use strict';

// Dashboard live-status polling + start/stop actions. Vanilla JS, no deps.
// VMs are keyed by their VirtualBox UUID (data-vm-uuid).

(function () {
  var POLL_INTERVAL_MS = 5000;
  var table = document.getElementById('vm-table');
  if (!table) return;
  var pollStatus = document.querySelector('[data-role="poll-status"]');

  function badgeClass(state) {
    if (state === 'running') return 'badge badge-running';
    if (state === 'stopped') return 'badge badge-stopped';
    return 'badge badge-unknown';
  }

  function applyStatus(vms) {
    var byUuid = {};
    vms.forEach(function (vm) { byUuid[vm.uuid] = vm; });

    var rows = table.querySelectorAll('tr[data-vm-uuid]');
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
          setNotice('Live status \u2014 last updated ' + new Date().toLocaleTimeString(), false);
        }
      })
      .catch(function (err) {
        if (err && err.message === 'unauthorized') return;
        setNotice('Could not refresh status (will retry).', true);
      });
  }

  // --- Start/Stop actions ---

  function doAction(row, action) {
    var uuid = row.getAttribute('data-vm-uuid');
    if (!uuid) return;

    if (action === 'stop') {
      if (!window.confirm('Send ACPI shutdown to this VM?')) return;
    }

    row.setAttribute('data-busy', '1');
    var buttons = row.querySelectorAll('button[data-action]');
    buttons.forEach(function (b) { b.disabled = true; });
    setNotice((action === 'start' ? 'Starting' : 'Stopping') + ' VM\u2026', false);

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
          setNotice('Action failed: ' + (r.message || 'unknown error'), true);
        } else {
          setNotice(action === 'start' ? 'VM start requested.' : 'VM stop requested.', false);
        }
      })
      .catch(function (err) {
        if (err && err.message === 'unauthorized') return;
        setNotice('Action failed (network error).', true);
      })
      .then(function () {
        row.removeAttribute('data-busy');
        poll();
      });
  }

  table.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('button[data-action]') : null;
    if (!btn || btn.disabled) return;
    var row = btn.closest('tr[data-vm-uuid]');
    if (row) doAction(row, btn.getAttribute('data-action'));
  });

  poll();
  setInterval(poll, POLL_INTERVAL_MS);
})();
