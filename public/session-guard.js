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

  var LOGIN_PAGE = '/student-login.html';
  var CACHED_IDENTITY_KEYS = ['employeeId', 'studentData', 'v2StudentData', 'studentInfo'];

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

  function goToLogin() {
    redirecting = true;
    clearCachedIdentity();
    var back = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(LOGIN_PAGE + '?next=' + back);
  }

  window.fetch = function (input, init) {
    return nativeFetch(input, init).then(function (response) {
      if (response.status !== 401 || redirecting || !isSameOrigin(input)) {
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
