'use strict';

// Cloud-Init page: template picker (fills the shared form from a
// data-templates JSON blob - same idiom as data-port-ranges in
// editVmTabs.js), confirm-before-submit for template/ISO delete (same
// pattern as public/disks.js), and the "Mount to VM" redirect.

(function () {
  var form = document.getElementById('cloud-init-form');
  if (!form) return;

  var select = document.getElementById('cloud-init-template-select');
  var idField = document.getElementById('cloud-init-template-id');
  var nameField = document.getElementById('cloud-init-template-name');
  var textarea = document.getElementById('cloud-init-userdata');

  var templates = [];
  try {
    templates = JSON.parse(form.getAttribute('data-templates') || '[]');
  } catch (e) {
    templates = [];
  }

  select.addEventListener('change', function () {
    var id = select.value;
    if (!id) {
      idField.value = '';
      nameField.value = '';
      return;
    }
    var match = null;
    for (var i = 0; i < templates.length; i++) {
      if (templates[i].id === id) {
        match = templates[i];
        break;
      }
    }
    if (!match) return;
    idField.value = match.id;
    nameField.value = match.name;
    textarea.value = match.userData;
  });
})();

// Confirm-before-submit for template/ISO delete - same getAttribute pattern
// as public/disks.js, so the name/filename can't break out of a JS string
// the way an inline onsubmit built from escaped HTML could.
(function () {
  document.querySelectorAll('form[data-confirm-delete-template]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      var name = form.getAttribute('data-confirm-delete-template');
      if (!window.confirm('Delete the saved template "' + name + '"?')) {
        ev.preventDefault();
      }
    });
  });
})();

(function () {
  document.querySelectorAll('form[data-confirm-delete-iso]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      var name = form.getAttribute('data-confirm-delete-iso');
      if (!window.confirm('Delete the generated ISO "' + name + '" from disk?\n\nThis cannot be undone.')) {
        ev.preventDefault();
      }
    });
  });
})();

// "Mount to VM": send the admin to that VM's Edit page, Storage tab, with
// the ISO path pre-filled into the existing attach form - no separate
// attach flow, just a shortcut into the one that already exists.
(function () {
  document.querySelectorAll('[data-mount-iso-btn]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var row = btn.closest('tr');
      var select = row ? row.querySelector('[data-mount-vm-select]') : null;
      var uuid = select ? select.value : '';
      var isoPath = btn.getAttribute('data-iso-path');
      if (!uuid) {
        window.alert('Pick a VM first.');
        return;
      }
      window.location.href = '/vms/' + encodeURIComponent(uuid) + '/edit?attachIso=' + encodeURIComponent(isoPath) + '#storage';
    });
  });
})();
