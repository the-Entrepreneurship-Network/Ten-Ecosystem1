/**
 * The notification orb.
 *
 * A round badge that docks against the right edge of the portal and answers one
 * question without the reader going looking: is there anything waiting for me?
 *
 * How it behaves, and why:
 *
 *   - On sign-in it appears ONCE, and only if something is actually pending.
 *     An orb that greets everyone with "0" is furniture; one that only ever
 *     shows up when there is something to see is worth glancing at. It enters
 *     expanded — "2 new messages" — so the first look needs no click, then
 *     settles down to a plain circle a few seconds later.
 *
 *   - While the portal is already open and something arrives, it BUZZES: a
 *     short physical shake, plus the phone's own vibration where the browser
 *     allows it. A badge that silently ticks from 1 to 2 is not noticed by
 *     someone reading the middle of the page.
 *
 *   - Clicking it goes where the newest thing is — straight into the
 *     conversation if it is a message, the notification centre otherwise.
 *
 * It docks at the right edge, vertically centred, deliberately: the chat
 * launcher lives in the bottom-right corner at a similar z-index, and two
 * floating circles fighting over one corner is how the mobile layout broke last
 * time.
 *
 * Include on any signed-in portal page. It works for students, coordinators, HR
 * and admin — the feed behind it is scoped by session on the server.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;
  if (window.__tenNotifyOrb) return;
  window.__tenNotifyOrb = true;

  var POLL_MS = 45000;           // portal notifications have no live channel
  var SETTLE_MS = 4600;          // how long the expanded label stays up
  var STORAGE_KEY = 'ten-orb-greeted';

  var state = { unread: 0, url: '/notifications', label: '', ready: false };
  var el = null, labelEl = null, countEl = null;
  var settleTimer = null, buzzTimer = null;
  var dismissed = false;

  /* ── styles ──────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('ten-orb-styles')) return;
    var css = [
      '#ten-orb{position:fixed;right:16px;top:50%;transform:translateY(-50%) scale(0);',
      'z-index:9997;display:flex;align-items:center;gap:0;cursor:pointer;',
      'background:linear-gradient(135deg,#1a2540,#0e1628);border:1px solid rgba(245,197,66,.45);',
      'border-radius:999px;padding:0;height:56px;min-width:56px;',
      'box-shadow:0 10px 30px rgba(0,0,0,.55),0 0 0 4px rgba(245,197,66,.10);',
      "font-family:'Plus Jakarta Sans','Segoe UI',system-ui,sans-serif;color:#e8edf7;",
      'opacity:0;pointer-events:none;',
      'transition:transform .42s cubic-bezier(.2,1.5,.4,1),opacity .3s ease,min-width .35s ease;}',

      // `.in` is the settled state: a circle at the edge.
      '#ten-orb.in{transform:translateY(-50%) scale(1);opacity:1;pointer-events:auto;}',
      // `.open` is the arrival state: wide enough to read.
      '#ten-orb.open{min-width:0;}',

      '#ten-orb-face{position:relative;width:56px;height:56px;flex:0 0 56px;',
      'display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;}',
      '#ten-orb-count{position:absolute;top:6px;right:6px;min-width:20px;height:20px;padding:0 5px;',
      'border-radius:999px;background:#f43f5e;color:#fff;font-size:11px;font-weight:800;',
      'display:none;align-items:center;justify-content:center;box-shadow:0 0 0 2px #0e1628;}',
      '#ten-orb-count.on{display:flex;}',

      '#ten-orb-label{max-width:0;overflow:hidden;white-space:nowrap;font-size:13px;font-weight:700;',
      'opacity:0;transition:max-width .38s ease,opacity .28s ease,padding .38s ease;padding:0;}',
      '#ten-orb.open #ten-orb-label{max-width:min(52vw,230px);opacity:1;padding:0 18px 0 2px;}',

      '#ten-orb-x{display:none;position:absolute;top:-7px;left:-7px;width:22px;height:22px;',
      'border-radius:50%;background:#111a2e;border:1px solid rgba(255,255,255,.18);color:#94a3b8;',
      'font-size:12px;line-height:1;align-items:center;justify-content:center;cursor:pointer;padding:0;}',
      '#ten-orb.in:hover #ten-orb-x,#ten-orb.open #ten-orb-x{display:flex;}',

      // The resting pulse: a slow gold ring, so a settled orb still reads as live.
      '#ten-orb::after{content:"";position:absolute;inset:-3px;border-radius:999px;',
      'border:2px solid rgba(245,197,66,.55);opacity:0;pointer-events:none;}',
      '#ten-orb.in::after{animation:ten-orb-pulse 2.8s ease-out infinite;}',
      '@keyframes ten-orb-pulse{0%{opacity:.65;transform:scale(1);}70%{opacity:0;transform:scale(1.35);}100%{opacity:0;transform:scale(1.35);}}',

      // The buzz: something arrived while you were looking elsewhere.
      '#ten-orb.buzz{animation:ten-orb-buzz .82s cubic-bezier(.36,.07,.19,.97) 2;}',
      '@keyframes ten-orb-buzz{',
      '10%,90%{transform:translateY(-50%) scale(1) translateX(-2px) rotate(-6deg);}',
      '20%,80%{transform:translateY(-50%) scale(1.06) translateX(4px) rotate(7deg);}',
      '30%,50%,70%{transform:translateY(-50%) scale(1.08) translateX(-6px) rotate(-9deg);}',
      '40%,60%{transform:translateY(-50%) scale(1.08) translateX(6px) rotate(9deg);}',
      '100%{transform:translateY(-50%) scale(1);}}',

      // A phone has less room and a thumb reaches the lower half more easily.
      '@media (max-width:820px){',
      '#ten-orb{right:12px;top:auto;bottom:calc(128px + env(safe-area-inset-bottom));transform:translateY(0) scale(0);}',
      '#ten-orb.in{transform:translateY(0) scale(1);}',
      '#ten-orb.buzz{animation:ten-orb-buzz-m .82s cubic-bezier(.36,.07,.19,.97) 2;}',
      '@keyframes ten-orb-buzz-m{',
      '10%,90%{transform:translateX(-2px) rotate(-6deg);}',
      '20%,80%{transform:translateX(4px) rotate(7deg);}',
      '30%,50%,70%{transform:translateX(-6px) rotate(-9deg) scale(1.06);}',
      '40%,60%{transform:translateX(6px) rotate(9deg) scale(1.06);}',
      '100%{transform:translateX(0) scale(1);}}}',

      // Respect a reader who has asked the system for less movement: they still
      // get the orb and the count, just no shaking.
      '@media (prefers-reduced-motion:reduce){',
      '#ten-orb,#ten-orb.buzz{animation:none !important;transition:opacity .2s ease;}',
      '#ten-orb.in::after{animation:none;}}'
    ].join('');
    var tag = document.createElement('style');
    tag.id = 'ten-orb-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ── the element ─────────────────────────────────────────────────────── */
  function build() {
    if (el) return;
    injectStyles();
    el = document.createElement('div');
    el.id = 'ten-orb';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML =
      '<div id="ten-orb-face">\uD83D\uDD14<span id="ten-orb-count"></span>' +
        '<button id="ten-orb-x" type="button" aria-label="Hide until something new arrives">\u2715</button>' +
      '</div>' +
      '<span id="ten-orb-label"></span>';
    document.body.appendChild(el);
    labelEl = document.getElementById('ten-orb-label');
    countEl = document.getElementById('ten-orb-count');

    el.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'ten-orb-x') return;
      go();
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
    document.getElementById('ten-orb-x').addEventListener('click', function (e) {
      e.stopPropagation();
      hide();
      // Dismissed, not silenced: the next arrival brings it straight back,
      // which is the whole point of the thing.
      dismissed = true;
    });
  }

  function go() {
    window.location.href = state.url || '/notifications';
  }

  function show(expanded) {
    build();
    el.classList.add('in');
    if (expanded) {
      el.classList.add('open');
      clearTimeout(settleTimer);
      // Settle to a circle on its own, so it stops covering the page.
      settleTimer = setTimeout(function () { if (el) el.classList.remove('open'); }, SETTLE_MS);
    }
  }

  function hide() {
    if (!el) return;
    el.classList.remove('in', 'open');
  }

  function setCount(n, label) {
    build();
    state.unread = n;
    if (n > 0) {
      countEl.classList.add('on');
      countEl.textContent = n > 99 ? '99+' : String(n);
    } else {
      countEl.classList.remove('on');
    }
    labelEl.textContent = label || '';
    el.setAttribute('aria-label', label || (n + ' unread'));
    el.title = label || '';
  }

  /**
   * The buzz.
   *
   * Two channels, because neither alone reaches everyone: the shake is what a
   * reader on a laptop sees, and navigator.vibrate is what a reader holding
   * their phone feels. Chrome only honours vibrate after a real interaction on
   * the page and silently ignores it otherwise, which is fine — the shake still
   * runs.
   */
  function buzz() {
    build();
    show(true);
    clearTimeout(buzzTimer);
    el.classList.remove('buzz');
    // Reflow, or re-adding the class in the same frame does not restart it.
    void el.offsetWidth;
    el.classList.add('buzz');
    buzzTimer = setTimeout(function () { if (el) el.classList.remove('buzz'); }, 1800);

    try {
      if (navigator.vibrate) navigator.vibrate([90, 60, 90]);
    } catch (e) { /* not permitted here; the shake carries it */ }
  }

  /* ── data ────────────────────────────────────────────────────────────── */
  function phrase(d) {
    var m = d.messages || 0, n = d.notifications || 0;
    if (m && n) return m + ' new message' + (m > 1 ? 's' : '') + ' \u00b7 ' + n + ' update' + (n > 1 ? 's' : '');
    if (m) return m + ' new message' + (m > 1 ? 's' : '');
    if (n) return n + ' new notification' + (n > 1 ? 's' : '');
    return '';
  }

  function refresh(cause) {
    return fetch('/api/notifications/unread-count', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.success) return;

        var before = state.unread;
        // Captured BEFORE it is set, so the first count on a page is a
        // starting point rather than an arrival — otherwise every page load
        // with something waiting would shake at the reader.
        var wasReady = state.ready;
        var total = d.unread || 0;
        state.url = (d.latest && d.latest.url) || '/notifications';

        setCount(total, phrase(d));
        state.ready = true;

        // Anything that is already on this page is not news. Someone reading
        // their inbox does not need an orb shaking at them about the message
        // they are looking at.
        if (onOwnPage()) { hide(); return; }

        if (total === 0) { hide(); return; }

        // Any increase after the first count is an arrival, including 0 -> 1 —
        // which is the case that most deserves a buzz, and the one an earlier
        // `before !== 0` guard was quietly swallowing.
        if (cause === 'live' || (wasReady && total > before)) {
          buzz();
          return;
        }
        if (dismissed) return;

        // The once-per-sign-in greeting.
        if (cause === 'first') {
          var key = STORAGE_KEY + ':' + ((d.me && d.me.id) || '');
          var greeted = false;
          try { greeted = sessionStorage.getItem(key) === '1'; } catch (e) {}
          show(!greeted);
          try { sessionStorage.setItem(key, '1'); } catch (e) {}
        } else {
          show(false);
        }
      })
      .catch(function () { /* offline or signed out; the next tick tries again */ });
  }

  /** Is the reader already looking at the thing the orb would send them to? */
  function onOwnPage() {
    var p = window.location.pathname;
    return p.indexOf('/notifications') === 0 || p.indexOf('/messages') === 0;
  }

  /* ── live ────────────────────────────────────────────────────────────── */
  function connectLive() {
    // A direct message already emits `dm_notice` on the socket the portal
    // opens for chat. Portal notifications have no live channel, so those are
    // caught by the poll below.
    if (!window.io) return;
    try {
      var socket = window.__tenOrbSocket || window.io({ withCredentials: true });
      window.__tenOrbSocket = socket;
      socket.on('dm_notice', function () { dismissed = false; refresh('live'); });
      socket.on('notification', function () { dismissed = false; refresh('live'); });
    } catch (e) { /* chat is unavailable on this page; polling still works */ }
  }

  function start() {
    refresh('first');
    connectLive();
    setInterval(function () { refresh('poll'); }, POLL_MS);

    // Coming back to the tab is exactly when a stale count is most visible.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh('poll');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /**
   * The page's handle on the orb.
   *
   *   refresh()  — recount quietly, e.g. after marking everything read.
   *   arrived()  — something just came in on a channel only this page can see
   *                (the student dashboard's SSE stream, say). Recount AND buzz.
   *   buzz()     — shake it now, without waiting for a recount.
   */
  window.TenNotifyOrb = {
    refresh: function () { return refresh('poll'); },
    arrived: function () { dismissed = false; return refresh('live'); },
    buzz: buzz
  };
})();
