'use strict';

// Confirm-before-submit for "Remove"/"Detach" on the host-wide Virtual media
// page. The full, already-translated confirm message is rendered server-side
// into the data attribute (views/disksPage.js, via lib/i18n.js) - this script
// just reads it back via getAttribute (a plain string, never re-parsed as
// HTML or JS, so it can't break out of a JS string literal the way an inline
// onsubmit="confirm('...')" built from escaped HTML could) and shows it.
(function () {
  document.querySelectorAll('form[data-confirm-delete-medium]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-delete-medium'))) {
        ev.preventDefault();
      }
    });
  });
})();

(function () {
  document.querySelectorAll('form[data-confirm-detach-disk]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-detach-disk'))) {
        ev.preventDefault();
      }
    });
  });
})();
