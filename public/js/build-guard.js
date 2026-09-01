/**
 * Reload the page once when the server has been deployed under it.
 *
 * WHY THIS EXISTS
 *
 * Three fixes in a row were reported as "still broken" when the server-side
 * half was demonstrably live. The last one is the clearest: the attendance card
 * printed an old sentence around a new number —
 *
 *     "26 working days have passed … so you need 20 of them … Attend 48 more"
 *
 * 20 came from the page's own arithmetic, 48 from the server's. Both were
 * internally correct; together they were nonsense, because the page was from
 * before the deploy and the API reply was from after it.
 *
 * public/ is served with `Cache-Control: no-cache` on HTML and JS, so a browser
 * revalidates — but a page already open in a tab, or held by a proxy, keeps
 * running old code against a new API for as long as it stays open. Nothing told
 * it otherwise.
 *
 * HOW IT WORKS
 *
 * Every response carries X-TEN-Build. The page remembers the last build it saw.
 * When the server's build changes, the page reloads itself, once, and comes
 * back current. It never needs to know its own version — only that the server's
 * has moved.
 *
 * The once-only guard lives in sessionStorage, so a genuine loop (a server
 * whose build changes on every request) costs one reload, not an infinite
 * cycle.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  if (window.__tenBuildGuard) return;
  window.__tenBuildGuard = true;

  var SEEN = 'ten-build';           // localStorage: the last build we ran against
  var RELOADED = 'ten-build-reload'; // sessionStorage: we already reloaded for it

  function read(store, key) {
    try { return window[store].getItem(key); } catch (e) { return null; }
  }
  function write(store, key, value) {
    try { window[store].setItem(key, value); } catch (e) { /* private mode */ }
  }

  function saw(build) {
    if (!build) return;

    var previous = read('localStorage', SEEN);
    if (!previous) { write('localStorage', SEEN, build); return; }
    if (previous === build) {
      // Back in step — allow a future reload again.
      try { window.sessionStorage.removeItem(RELOADED); } catch (e) {}
      return;
    }

    // The server moved. Take the new build first, so a reload that somehow does
    // not refresh the page cannot loop on the old value.
    write('localStorage', SEEN, build);
    if (read('sessionStorage', RELOADED) === build) return;
    write('sessionStorage', RELOADED, build);

    // Let anything in flight finish; a reload mid-save is worse than a stale
    // sentence.
    setTimeout(function () { window.location.reload(); }, 400);
  }

  var nativeFetch = window.fetch;
  window.fetch = function () {
    return nativeFetch.apply(this, arguments).then(function (res) {
      try { saw(res.headers.get('X-TEN-Build')); } catch (e) {}
      return res;
    });
  };
})();
