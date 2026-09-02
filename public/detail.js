'use strict';

// VM detail page script: start/stop actions (same contract as the dashboard)
// plus periodic screenshot refresh while the VM is running. Vanilla JS.

(function () {
  var card = document.querySelector('.card[data-vm-uuid]');
  if (!card) return;
  var vmUuid = card.getAttribute("data-vm-uuid");
  var pollStatus = document.querySelector('[data-role="poll-status"]');
  var shot = document.getElementById('vm-screenshot');

  function setNotice(text, isError) {
    if (!pollStatus) return;
    pollStatus.textContent = text || '';
    pollStatus.className = isError ? 'error' : 'muted';
  }

  // --- Start/Stop (mirrors dashboard behavior) ---
  function doAction(action, mode) {
    if (action === 'stop') {
      var confirmMsg = mode === 'hard'
        ? 'Force stop (power off) this VM? Unsaved data in the guest will be lost.'
        : 'Send ACPI shutdown to this VM?';
      if (!window.confirm(confirmMsg)) return;
    }

    var buttons = card.querySelectorAll('button[data-action]');
    buttons.forEach(function (b) { b.disabled = true; });
    setNotice((action === 'start' ? 'Starting' : 'Stopping') + ' VM\u2026', false);

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
          r.ok ? 'Action requested. Reloading\u2026' : 'Action failed: ' + (r.message || 'unknown error'),
          !r.ok
        );
        // Reload after a moment so the page reflects new state/screenshot.
        if (r.ok) setTimeout(function () { window.location.reload(); }, 1500);
        else buttons.forEach(function (b) { b.disabled = false; });
      })
      .catch(function (err) {
        if (err && err.message === 'unauthorized') return;
        setNotice('Action failed (network error).', true);
        buttons.forEach(function (b) { b.disabled = false; });
      });
  }

  card.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('button[data-action]') : null;
    if (!btn || btn.disabled) return;
    doAction(btn.getAttribute('data-action'), btn.getAttribute('data-mode'));
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
