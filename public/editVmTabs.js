'use strict';

// Tab switching for the Edit VM page. Progressive enhancement: panels have
// no `hidden` attribute in the server-rendered HTML, so without JS the page
// still works exactly as before (one long scrolling list). This script just
// hides all but the active panel and wires up the tab buttons.

(function () {
  var buttons = document.querySelectorAll('[data-tab-btn]');
  var panels = document.querySelectorAll('[data-tab-panel]');
  if (!buttons.length || !panels.length) return;

  var STORAGE_KEY = 'vbm-edit-tab';

  // Storage and Shared Folders live entirely in their own add/remove forms
  // OUTSIDE the main settings <form> (see views/editVm.js) - "Save changes"
  // submits the main form and has no effect on either, so hide it on those
  // tabs to avoid implying it would save something it can't.
  var NO_SAVE_BUTTON_TABS = ['storage', 'sharedfolders'];
  var saveBtn = document.getElementById('save-settings-btn');

  function activate(name) {
    panels.forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-tab-panel') !== name;
    });
    buttons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab-btn') === name);
    });
    if (saveBtn) saveBtn.hidden = NO_SAVE_BUTTON_TABS.indexOf(name) !== -1;
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch (e) {
      // Ignore (private browsing, storage disabled, etc.) - tabs still work,
      // just without remembering the last one across page loads.
    }
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activate(btn.getAttribute('data-tab-btn'));
    });
  });

  var initial = buttons[0].getAttribute('data-tab-btn');
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved && document.querySelector('[data-tab-panel="' + saved + '"]')) {
      initial = saved;
    }
  } catch (e) {
    // Ignore; fall back to the first tab.
  }
  // A URL hash (e.g. a link elsewhere in the app sending the admin straight
  // to #storage) wins over the remembered tab - it's a deliberate one-time
  // navigation target, not a preference to override.
  var hashTab = window.location.hash.slice(1);
  if (hashTab && document.querySelector('[data-tab-panel="' + hashTab + '"]')) {
    initial = hashTab;
  }
  activate(initial);
})();

// Confirm-before-submit for "Remove controller" / "Delete disk" forms. The
// full, already-translated confirm message is rendered server-side into the
// data attribute (views/editVm.js, via lib/i18n.js). Uses a data attribute +
// addEventListener rather than an inline onsubmit="confirm('...')" string:
// read back via getAttribute (a plain string, never re-parsed as HTML or
// JS), so it can't break out of a JS string literal the way an HTML-escaped
// value inlined into an attribute could.
(function () {
  document.querySelectorAll('form[data-confirm-remove-controller]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-remove-controller'))) {
        ev.preventDefault();
      }
    });
  });
})();

(function () {
  document.querySelectorAll('form[data-confirm-delete-disk]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-delete-disk'))) {
        ev.preventDefault();
      }
    });
  });
})();

// "Add a controller" - VBoxManage fixes the port count for several buses
// (IDE always 2, SCSI always 16, USB always 8, floppy always 1 - confirmed
// by testing) rather than letting it vary like SATA/SAS/PCIe do. Reflect
// that in the Ports field instead of leaving a fixed generic default that
// only happens to be valid for some buses: lock/disable it for fixed-count
// buses, otherwise open it up to that bus's real min/max.
(function () {
  var busSelect = document.querySelector('[data-controller-bus]');
  var portInput = document.querySelector('[data-controller-portcount]');
  var help = document.querySelector('[data-controller-port-help]');
  if (!busSelect || !portInput) return;

  var ranges = {};
  try {
    ranges = JSON.parse(busSelect.getAttribute('data-port-ranges') || '{}');
  } catch (e) {
    ranges = {};
  }

  function applyRange() {
    var range = ranges[busSelect.value];
    if (!range) return;
    portInput.min = range.min;
    portInput.max = range.max;
    var fixed = range.min === range.max;
    portInput.disabled = fixed;
    portInput.value = fixed ? range.min : Math.min(Math.max(portInput.value || range.min, range.min), range.max);
    if (help) {
      var template = fixed ? help.getAttribute('data-i18n-fixed') : help.getAttribute('data-i18n-range');
      help.textContent = (template || '').replace('{min}', range.min).replace('{max}', range.max);
    }
  }

  busSelect.addEventListener('change', applyRange);
  applyRange();
})();
