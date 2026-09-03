'use strict';

// Confirm-before-submit for the various "Remove" actions on the Networks
// page (NAT networks, host-only interfaces, their DHCP servers). The full,
// already-translated confirm message is rendered server-side into the data
// attribute (views/networksPage.js, via lib/i18n.js). Same data-attribute +
// addEventListener pattern as editVmTabs.js/disks.js: read back via
// getAttribute (a plain string, never re-parsed as HTML or JS), so it can't
// break out of a JS string literal the way an inline onsubmit="confirm('...')"
// built from escaped HTML could.
(function () {
  document.querySelectorAll('form[data-confirm-remove-network]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.getAttribute('data-confirm-remove-network'))) {
        ev.preventDefault();
      }
    });
  });
})();
