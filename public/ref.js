/*
 * Remember which link brought this visitor (…?ref=li-2026-12-01-webdev) for 30
 * days, so the sign-up is credited to it even when they register later.
 * register.html sends window.tenSignupRef() with the form. The pattern is the
 * one in utils/signupRef.js; anything else is ignored.
 */
(function () {
  var RE = /^[a-z0-9][a-z0-9._-]{0,63}$/, KEY = 'ten_ref', DAYS = 30;
  var fromUrl = '';
  try { fromUrl = (new URLSearchParams(location.search).get('ref') || '').trim().toLowerCase(); } catch (e) {}
  if (!RE.test(fromUrl)) fromUrl = '';
  try { if (fromUrl) localStorage.setItem(KEY, JSON.stringify({ ref: fromUrl, at: Date.now() })); } catch (e) {}

  window.tenSignupRef = function () {
    if (fromUrl) return fromUrl;
    try {
      var kept = JSON.parse(localStorage.getItem(KEY) || 'null');
      return kept && RE.test(kept.ref) && Date.now() - kept.at < DAYS * 864e5 ? kept.ref : '';
    } catch (e) { return ''; }
  };
})();
