/**
 * "Install app" on the home page.
 *
 * Chrome, Edge and Android fire beforeinstallprompt when the site can be
 * installed; holding the event lets the button open the browser's own install
 * dialog when the visitor asks, rather than a banner they did not ask for.
 * iPhone Safari never fires it, so there the button says where the option is.
 * Inside the installed app, and in browsers that cannot install, it stays hidden.
 */
(function () {
  'use strict';
  var wrap = document.getElementById('installWrap');
  var btn = document.getElementById('installApp');
  if (!wrap || !btn) return;
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) return;

  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    wrap.hidden = false;
  });
  window.addEventListener('appinstalled', function () { wrap.hidden = true; deferred = null; });

  // iPadOS reports itself as a Mac; touch points give it away.
  var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) wrap.hidden = false;

  btn.addEventListener('click', function () {
    if (deferred) {
      var shown = deferred;
      deferred = null;          // a prompt can be shown once
      shown.prompt();
      shown.userChoice.then(function (c) { if (c.outcome === 'accepted') wrap.hidden = true; }).catch(function () {});
      return;
    }
    if (iOS) btn.textContent = 'TAP SHARE, THEN “ADD TO HOME SCREEN”';
  });
})();
