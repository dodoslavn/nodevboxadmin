'use strict';

// Confirm-before-submit for "Remove" on the host-wide Virtual media page.
// Same data-attribute + addEventListener pattern as editVmTabs.js: the path
// is read back via getAttribute (a plain string, never re-parsed as HTML or
// JS), so it can't break out of a JS string literal the way an inline
// onsubmit="confirm('...path...')" built from escaped HTML could.
(function () {
  document.querySelectorAll('form[data-confirm-delete-medium]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      var path = form.getAttribute('data-confirm-delete-medium');
      if (!window.confirm('Remove this medium from VirtualBox\'s registry? The file itself is left on disk.\n\n' + path)) {
        ev.preventDefault();
      }
    });
  });
})();

// Same pattern for "Detach" - not destructive like Delete, but still worth a
// confirm since it changes a specific VM's storage config.
(function () {
  document.querySelectorAll('form[data-confirm-detach-disk]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      var path = form.getAttribute('data-confirm-detach-disk');
      if (!window.confirm('Detach this disk?\n\n' + path)) {
        ev.preventDefault();
      }
    });
  });
})();
