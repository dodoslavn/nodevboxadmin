'use strict';

// VM detail page script: start/stop actions (same contract as the dashboard)
// plus periodic screenshot refresh while the VM is running. Vanilla JS.
//
// User-facing strings are read from data-i18n-* attributes rendered by
// views/vmDetail.js (already translated server-side via lib/i18n.js) rather
// than hardcoded here, so this script doesn't need its own translation
// mechanism - same idiom as the data-confirm-* attributes already used
// throughout this codebase for confirm() dialogs.

(function () {
  var card = document.querySelector('.card[data-vm-uuid]');
  if (!card) return;
  var vmUuid = card.getAttribute('data-vm-uuid');
  var pollStatus = document.querySelector('[data-role="poll-status"]');
  var shot = document.getElementById('vm-screenshot');

  function i18n(name) {
    return card.getAttribute('data-i18n-' + name) || '';
  }

  function setNotice(text, isError) {
    if (!pollStatus) return;
    pollStatus.textContent = text || '';
    pollStatus.className = isError ? 'error' : 'muted';
  }

  // --- Start/Stop (mirrors dashboard behavior) ---
  function doAction(action, mode) {
    if (action === 'stop') {
      var confirmMsg = mode === 'hard' ? i18n('confirm-hard') : i18n('confirm-acpi');
      if (!window.confirm(confirmMsg)) return;
    }

    var buttons = card.querySelectorAll('button[data-action]');
    buttons.forEach(function (b) { b.disabled = true; });
    setNotice((action === 'start' ? i18n('starting') : i18n('stopping')) + '…', false);

    fetch('/vms/' + encodeURIComponent(vmUuid) + '/' + action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body: action === 'stop' ? 'mode=' + (mode || 'acpi') : '',
    })
      .then(function (res) {
        if (res.status === 401) { window.location = '/login'; throw new Error('unauthorized'); }
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok && data.ok !== false, message: data.message };
        });
      })
      .then(function (r) {
        setNotice(
          r.ok ? i18n('action-requested') + '…' : i18n('action-failed') + ': ' + (r.message || i18n('unknown-error')),
          !r.ok
        );
        // Reload after a moment so the page reflects new state/screenshot.
        if (r.ok) setTimeout(function () { window.location.reload(); }, 1500);
        else buttons.forEach(function (b) { b.disabled = false; });
      })
      .catch(function (err) {
        if (err && err.message === 'unauthorized') return;
        setNotice(i18n('network-error'), true);
        buttons.forEach(function (b) { b.disabled = false; });
      });
  }

  card.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('button[data-action]') : null;
    if (!btn || btn.disabled) return;
    doAction(btn.getAttribute('data-action'), btn.getAttribute('data-mode'));
  });

  // --- Delete VM confirm - same data-attribute pattern as public/disks.js ---
  document.querySelectorAll('form[data-confirm-delete-vm]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-delete-vm'))) {
        ev.preventDefault();
      }
    });
  });

  // --- Screenshot refresh (only if the image is present, i.e. VM running) ---
  if (shot) {
    setInterval(function () {
      // Swap src with a fresh cache-buster; keep old image if the new one 404s.
      var next = new Image();
      next.onload = function () { shot.src = next.src; };
      next.src = '/vms/' + encodeURIComponent(vmUuid) + '/screenshot.png?t=' + Date.now();
    }, 5000);
  }
})();
