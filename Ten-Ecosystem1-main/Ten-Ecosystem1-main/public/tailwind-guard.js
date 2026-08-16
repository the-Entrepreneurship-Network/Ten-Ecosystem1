/**
 * Notice when the Tailwind CDN did not load, and say so.
 *
 * Fourteen pages — including register.html, which every new student must get
 * through — take their entire styling from `cdn.tailwindcss.com` at runtime.
 * When that request fails, and it does on college and office networks, on a
 * dropped mobile connection, and during a CDN outage, the page renders as raw
 * HTML: white background, 20px input boxes, no layout. The form still works,
 * but it looks like a broken or fake site, which is not something anyone should
 * be typing their details into.
 *
 * This detects that case and switches on `css/tailwind-fallback.css`, which
 * makes the page plain but recognisably the portal, and usable on a phone.
 *
 * Detection is by MEASUREMENT, not by watching for a load event: the CDN script
 * can arrive and still fail to generate styles, and an `onerror` handler misses
 * a request that hangs rather than fails. A probe element is given a known
 * Tailwind utility and its computed style is read.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;
  if (window.__tenTailwindGuard) return;
  window.__tenTailwindGuard = true;

  /**
   * Has Tailwind actually produced styles?
   *
   * `.sr-only` is used because its declaration is unmistakable — position
   * absolute with a 1px clip — and because nothing else in this codebase
   * defines it, so a positive result cannot come from the page's own CSS.
   */
  function tailwindIsWorking() {
    var probe = document.createElement('div');
    probe.className = 'sr-only';
    probe.style.cssText = '';   // no inline styles to confuse the read
    document.body.appendChild(probe);
    var cs = window.getComputedStyle(probe);
    var working = cs.position === 'absolute' && parseInt(cs.width, 10) <= 1;
    probe.parentNode.removeChild(probe);
    return working;
  }

  function applyFallback() {
    if (document.documentElement.classList.contains('no-tw')) return;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/tailwind-fallback.css';
    document.head.appendChild(link);
    document.documentElement.classList.add('no-tw');

    // Tell the person, rather than letting them wonder whether this is the
    // right site.
    if (!document.getElementById('tw-fallback-notice')) {
      var note = document.createElement('div');
      note.id = 'tw-fallback-notice';
      note.textContent = 'Some styling could not be loaded, so this page looks plainer than usual. Everything still works — you can carry on.';
      document.body.insertBefore(note, document.body.firstChild);
    }

    console.warn('[tailwind-guard] cdn.tailwindcss.com did not load; using the local fallback stylesheet.');
  }

  function check() {
    // The CDN builds styles asynchronously after its script runs, so give it a
    // moment before declaring it missing — and check twice, because a slow
    // connection can deliver it between the two.
    if (tailwindIsWorking()) return;
    setTimeout(function () {
      if (!tailwindIsWorking()) applyFallback();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }

  // A very slow connection can still deliver it after everything else; if it
  // arrives late, take the fallback back off so the page is not left plain.
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (document.documentElement.classList.contains('no-tw') && tailwindIsWorking()) {
        document.documentElement.classList.remove('no-tw');
        var note = document.getElementById('tw-fallback-notice');
        if (note && note.parentNode) note.parentNode.removeChild(note);
      }
    }, 2500);
  });
})();
