'use strict';

// Cloud-Init page: template picker (fills the shared form from a
// data-templates JSON blob - same idiom as data-port-ranges in
// editVmTabs.js) and confirm-before-submit for template/ISO delete (same
// pattern as public/disks.js).

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

// Confirm-before-submit for template/ISO delete - the full, already-
// translated confirm message is rendered server-side into the data
// attribute (lib/i18n.js); same getAttribute pattern as public/disks.js, so
// the name/filename can't break out of a JS string the way an inline
// onsubmit built from escaped HTML could.
(function () {
  document.querySelectorAll('form[data-confirm-delete-template]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-delete-template'))) {
        ev.preventDefault();
      }
    });
  });
})();

(function () {
  document.querySelectorAll('form[data-confirm-delete-iso]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-delete-iso'))) {
        ev.preventDefault();
      }
    });
  });
})();
