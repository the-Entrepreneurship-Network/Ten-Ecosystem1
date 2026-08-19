/**
 * Treat a 401 as a sign-out, everywhere.
 *
 * Identity now comes from the session cookie alone. The pages, however, still
 * cache `employeeId` / `studentData` in localStorage and render from it, and
 * that cache outlives the cookie — a rotated SESSION_SECRET, a timeout, or
 * signing out in another tab all end the session while localStorage stays put.
 *
 * The result was a page that drew itself completely and then reported the
 * resulting 401 in whatever words that page happened to use:
 *
 *   my-certificates.html  "Could not load certificates."
 *   v2-tasks.html         a red Error dialog, "Please sign in to continue."
 *
 * Both read as data loss or a broken server. Neither is: the student is simply
 * signed out. This wraps fetch once so every page answers a 401 the same way —
 * clear the stale cache and go to the login screen, remembering where they
 * were.
 *
 * Include on signed-in pages only. A login page legitimately receives 401 for
 * a wrong password, and redirecting on that would loop.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (window.__tenSessionGuardInstalled) return;
  window.__tenSessionGuardInstalled = true;

  // /login.html is the portal-wide sign-in page and the one the rest of the
  // product already redirects to (student-dashboard, quiz-portal, payment,
  // v2-tasks). It reads the ?next= below and returns the student to the page
  // they were on; student-login.html does the same, but only /login.html is
  // reachable from every entry point, so keep the whole product on one door.
  var LOGIN_PAGE = '/login.html';

  // `student` is the key the dashboard actually renders from
  // (`JSON.parse(localStorage.getItem('student'))`). Leaving it behind meant a
  // signed-out student was sent to the login page while a full, stale profile
  // stayed in storage — so the next page load drew a signed-in dashboard from
  // the cache before its first fetch failed and bounced them again.
  var CACHED_IDENTITY_KEYS = [
    'employeeId', 'student', 'studentData', 'v2StudentData', 'studentInfo',
    'ten_employee_id', 'ten_token', 'sessionToken', 'user', 'userId', 'role'
  ];

  var nativeFetch = window.fetch.bind(window);
  var redirecting = false;

  // Only same-origin responses say anything about OUR session. A 401 from a
  // third-party API means nothing about whether this student is signed in.
  function isSameOrigin(input) {
    try {
      var url = typeof input === 'string' ? input
              : (input && input.url) ? input.url
              : String(input);
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (err) {
      return false;
    }
  }

  function clearCachedIdentity() {
    CACHED_IDENTITY_KEYS.forEach(function (key) {
      try { window.localStorage.removeItem(key); } catch (err) { /* private mode */ }
      try { window.sessionStorage.removeItem(key); } catch (err) { /* private mode */ }
    });
  }

  /**
   * The loop breaker.
   *
   * A 401 sends the student to the login page. If signing in succeeds but the
   * very next request 401s again — a server-side identity mismatch, a session
   * that will not stick, a cookie the browser is refusing — this bounces
   * forever, and the student can do nothing but watch it. It has happened.
   *
   * So a bounce is recorded, and if we come back here again within the window
   * we stop and SAY so instead of going round once more. One clear message
   * beats an infinite redirect, whatever caused it. A sign-in that actually
   * works clears the count on the next quiet page load.
   */
  var LOOP_KEY = 'ten_auth_bounce';
  var LOOP_WINDOW_MS = 30000;
  var LOOP_LIMIT = 2;

  function bounceCount() {
    try {
      var raw = window.sessionStorage.getItem(LOOP_KEY);
      if (!raw) return 0;
      var rec = JSON.parse(raw);
      if (!rec || (Date.now() - rec.at) > LOOP_WINDOW_MS) return 0;
      return rec.n || 0;
    } catch (err) { return 0; }
  }

  function recordBounce(n) {
    try {
      window.sessionStorage.setItem(LOOP_KEY, JSON.stringify({ n: n, at: Date.now() }));
    } catch (err) { /* private mode */ }
  }

  function showStuckMessage() {
    redirecting = true;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;'
      + 'justify-content:center;padding:24px;background:rgba(5,7,14,0.97);color:#e8e4da;'
      + 'font-family:Inter,system-ui,sans-serif;text-align:center;';
    box.innerHTML =
      '<div style="max-width:460px">'
      + '<div style="font-size:40px;margin-bottom:10px">🔑</div>'
      + '<h2 style="margin:0 0 10px;font-size:20px">We cannot keep you signed in</h2>'
      + '<p style="margin:0 0 18px;color:#8aa0bf;font-size:14px;line-height:1.6">'
      + 'Your sign-in is working, but the server is not accepting the session that '
      + 'follows it. This is a fault on our side, not something you did.<br><br>'
      + 'Please send your Employee ID to your coordinator so we can repair the account.</p>'
      + '<button id="tenRetryAuth" style="min-height:44px;padding:11px 22px;border-radius:10px;'
      + 'border:none;background:#D4AF37;color:#05070e;font-weight:800;font-size:14px;cursor:pointer">'
      + 'Try once more</button></div>';
    var mount = function () {
      document.body.appendChild(box);
      var btn = document.getElementById('tenRetryAuth');
      if (btn) btn.onclick = function () {
        try { window.sessionStorage.removeItem(LOOP_KEY); } catch (err) { /* ignore */ }
        window.location.replace(LOGIN_PAGE);
      };
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  function goToLogin() {
    var n = bounceCount() + 1;
    if (n > LOOP_LIMIT) {
      // Round three. Stop, and tell them what is happening.
      showStuckMessage();
      return;
    }
    recordBounce(n);
    redirecting = true;
    clearCachedIdentity();
    var back = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(LOGIN_PAGE + '?next=' + back);
  }

  /**
   * Is this 401 really "you are signed out"?
   *
   * It used to be enough that a same-origin call answered 401. It is not: a 401
   * can mean one endpoint refused one request for its own reasons, and treating
   * every one of them as a lost session is what produced an inescapable sign-in
   * loop — the guard would clear the cached employeeId, an endpoint that read
   * that value would then 401 because it was missing, and round it went.
   *
   * The server now marks a genuine session failure explicitly, so only that is
   * acted on. Anything else is left for the calling page to handle.
   */
  function isSessionFailure(response) {
    try {
      if (response.headers && response.headers.get('X-Session-Expired') === '1') return true;
    } catch (err) { /* opaque response */ }
    return false;
  }

  window.fetch = function (input, init) {
    return nativeFetch(input, init).then(function (response) {
      if (response.status !== 401 || redirecting || !isSameOrigin(input)) {
        return response;
      }
      if (!isSessionFailure(response)) {
        // Not a session problem — hand it back and let the page say so.
        return response;
      }

      goToLogin();

      // Never resolves. The navigation is already underway; resolving would let
      // the caller paint "Could not load…" over a page that is going away, which
      // is the exact confusion this exists to prevent.
      return new Promise(function () {});
    });
  };
})();
