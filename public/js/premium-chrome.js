'use strict';
/* globals window, document, fetch */

/*
 * Turn the whole portal premium, on every page.
 *
 * There is no premium section and no premium page: a student on a paid track
 * signs in and the portal they already use is gold instead of navy, with their
 * plan beside their name. Everyone else's portal is untouched — nobody is shown
 * a locked box they cannot open.
 *
 * The server decides (utils/premium.js via /api/v2/premium/me); this only
 * reflects it. It lives in one file because the theme has to reach every
 * student page, and a copy per page is a theme that drifts.
 */
(function initPremiumChrome() {
  var CACHE_KEY = 'ten-premium';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /*
   * Paint from the last known answer before the network is asked.
   *
   * Without this the portal loads navy and turns gold a moment later, which
   * reads as a page repainting itself. Only ever a cached yes/no plan name —
   * the server is still the authority and corrects it below.
   */
  function paintFromCache() {
    try {
      var raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      var c = JSON.parse(raw);
      if (c && c.premium) apply(c);
    } catch (e) { /* private mode, or nothing cached */ }
  }

  function apply(d) {
    document.body.classList.add('is-premium');

    /*
     * Plan beside the student's name — the header, not a panel of its own.
     *
     * VISIBLE heading, not merely the first one that exists: the dashboard
     * carries several, one per view, and all but the open one are display:none.
     * Appending to a hidden heading put the chip on the page and nowhere on the
     * screen.
     */
    var candidates = [
      document.querySelector('.section-cards-heading'),
      document.getElementById('welcomeText'),
      document.querySelector('h1')
    ].filter(Boolean);
    var host = candidates.filter(function (el) { return el.offsetParent !== null; })[0]
            || candidates[0];
    if (host && !document.getElementById('premiumMark')) {
      var mark = document.createElement('span');
      mark.id = 'premiumMark';
      mark.className = 'premium-mark';
      mark.innerHTML = '<span class="pm-star">✦</span>' + esc(d.plan || 'Premium') + ' member';
      host.appendChild(mark);
    }

    // Members-only pieces that start hidden in the markup.
    ['assistantCard', 'assistantNavBtn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = '';
    });
  }

  function unapply() {
    document.body.classList.remove('is-premium');
    var mark = document.getElementById('premiumMark');
    if (mark) mark.remove();
  }

  async function refresh() {
    var d;
    try {
      var res = await fetch('/api/v2/premium/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      d = await res.json();
    } catch (e) { return; }        // offline: leave whatever the cache painted
    if (!d || !d.success) return;

    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ premium: !!d.premium, plan: d.plan || '' }));
    } catch (e) { /* private mode */ }

    if (d.premium) apply(d);
    else unapply();               // a lapsed member must not keep the chrome

    window.TENPremium = d;
    document.dispatchEvent(new CustomEvent('ten:premium', { detail: d }));
  }

  paintFromCache();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { paintFromCache(); refresh(); });
  } else {
    refresh();
  }

  window.TENPremiumChrome = { refresh: refresh };
})();
