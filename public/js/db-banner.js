/**
 * "The database is not connected" — said out loud, on every page.
 *
 * The portal ran for some time with no database behind it. Every model fell
 * through to a JSON file on the server, the HR console listed an invented
 * student as though it were real, and registrations kept succeeding into that
 * file. Nothing on any screen said so, so nobody could know: the only symptom
 * was data that looked thin.
 *
 * It also says when the server's disk is filling. That is not a detail — the
 * outage this bar exists for began with a full disk: mongod could not write its
 * own log file and aborted at 2am, and nobody found out until the morning. A
 * disk at 90% is the warning nobody had.
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
  var DOWN = '#7f1d1d';     // the database is gone
  var FILLING = '#78350f';  // it is still here, but not for long
  var el = null;

  function ensure() {
    if (el && document.body.contains(el)) return el;
    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'alert');
    el.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483000',
      'background:' + DOWN, 'color:#fff',
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

  function paint(text, background) {
    var node = ensure();
    node.style.background = background;
    node.textContent = text;
    node.style.display = '';
    document.body.style.paddingTop = node.offsetHeight + 'px';
  }

  function hide() {
    if (!el) return;
    el.style.display = 'none';
    document.body.style.paddingTop = '';
  }

  function gb(bytes) {
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }

  function render(d) {
    if (!d) return;

    if (!d.connected) {
      paint('⚠ Database not connected' + (d.cause ? ' (' + String(d.cause) + ')' : '')
        + ' — what you see here is not live data, and anything saved now is being held in a '
        + 'temporary file on the server. Tell the site administrator.', DOWN);
      return;
    }

    /*
     * The database is up, so nothing is wrong yet — which is the whole point of
     * saying it now. Last time this went unsaid, mongod aborted at 2am on a full
     * disk and the portal spent the night writing registrations to a file.
     */
    if (d.disk && d.disk.low) {
      paint('⚠ The server disk is ' + d.disk.percentUsed + '% full ('
        + gb(d.disk.freeBytes) + ' free). When it fills, the database stops. '
        + 'Tell the site administrator.', FILLING);
      return;
    }

    hide();
  }

  function check() {
    // credentials so the check works the same signed in or out; it returns no
    // data either way.
    fetch('/api/health/db', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(render)
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
