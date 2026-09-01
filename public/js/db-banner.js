/**
 * "The database is not connected" — said out loud, on every page.
 *
 * The portal ran for some time with no database behind it. Every model fell
 * through to a JSON file on the server, the HR console listed an invented
 * student as though it were real, and registrations kept succeeding into that
 * file. Nothing on any screen said so, so nobody could know: the only symptom
 * was data that looked thin.
 *
 * This is the symptom. It sits at the top of the page, it cannot be dismissed
 * while the condition lasts, and it goes away by itself the moment the database
 * comes back — services/dbHealth.js keeps retrying the connection, so recovery
 * needs no deploy and no restart.
 *
 * Include on every page that shows or saves data.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  if (window.__tenDbBanner) return;
  window.__tenDbBanner = true;

  var ID = 'ten-db-banner';
  var POLL_MS = 20000;
  var el = null;

  function ensure() {
    if (el && document.body.contains(el)) return el;
    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'alert');
    el.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483000',
      'background:#7f1d1d', 'color:#fff',
      'font:600 13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
      'padding:10px 16px', 'text-align:center',
      'box-shadow:0 2px 12px rgba(0,0,0,.45)',
      'border-bottom:1px solid rgba(255,255,255,.25)'
    ].join(';');
    document.body.appendChild(el);
    // Push the page down rather than covering its own header.
    document.body.style.paddingTop = el.offsetHeight + 'px';
    return el;
  }

  function show(status) {
    var node = ensure();
    var detail = status && status.cause
      ? ' (' + String(status.cause) + ')'
      : '';
    node.textContent = '⚠ Database not connected' + detail
      + ' — what you see here is not live data, and anything saved now is being held in a '
      + 'temporary file on the server. Tell the site administrator.';
    node.style.display = '';
    document.body.style.paddingTop = node.offsetHeight + 'px';
  }

  function hide() {
    if (!el) return;
    el.style.display = 'none';
    document.body.style.paddingTop = '';
  }

  function check() {
    // credentials so the check works the same signed in or out; it returns no
    // data either way.
    fetch('/api/health/db', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (d) {
        if (d && d.connected) hide();
        else if (d) show(d);
      })
      .catch(function () {
        /* A failed check is not proof of anything — the network may simply be
           down for this one request. Say nothing rather than cry wolf. */
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
  setInterval(check, POLL_MS);
})();
