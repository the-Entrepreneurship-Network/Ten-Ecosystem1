/**
 * Give every page a way to reach its sidebar on a phone.
 *
 * mobile.css moves the sidebar off-canvas below 820px, which is the only way
 * the content pane gets the full width. That is fine on the pages that already
 * ship a hamburger (student dashboard, HR portal, coordinator dashboard) — but
 * four pages have a sidebar and no toggle at all (ten-admin, mentor, investor
 * and contractor dashboards). Off-canvas with no way to open it is worse than
 * cramped: the navigation is simply gone.
 *
 * So: if a page has a sidebar and no working toggle, one is added here. Pages
 * that already have their own are left completely alone — two hamburgers is
 * its own kind of broken.
 *
 * Deliberately dependency-free and defensive: it runs on every portal page,
 * and a script that throws in the head takes the page with it.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;
  if (window.__tenMobileNavInstalled) return;
  window.__tenMobileNavInstalled = true;

  var SIDEBAR_SELECTORS = ['.sidebar', '.stu-sidebar', '.coord-sidebar',
                           '.admin-sidebar', '.glass-sidebar', '.side-nav'];
  var BREAKPOINT = 820;

  function findSidebar() {
    for (var i = 0; i < SIDEBAR_SELECTORS.length; i++) {
      var el = document.querySelector(SIDEBAR_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  /**
   * Does the page already provide its own way in?
   *
   * Looked for by behaviour rather than by class name: anything whose handler
   * or label mentions the sidebar/menu counts, which covers the four different
   * conventions already in the tree without hard-coding each one.
   */
  function hasOwnToggle() {
    var candidates = document.querySelectorAll('button, a, div, span, i');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var attr = (el.getAttribute('onclick') || '') + ' ' +
                 (el.className && el.className.baseVal !== undefined ? '' : (el.className || '')) + ' ' +
                 (el.id || '');
      if (/toggleSidebar|sidebar-toggle|menu-toggle|hamburger|openSidebar|toggleMenu|toggleNav/i.test(attr)) {
        return true;
      }
    }
    return false;
  }

  function install() {
    var sidebar = findSidebar();
    if (!sidebar || hasOwnToggle()) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open navigation');
    btn.setAttribute('aria-expanded', 'false');
    btn.className = 'ten-mobile-nav-btn';
    btn.innerHTML = '&#9776;';
    btn.style.cssText = [
      'position:fixed', 'top:10px', 'left:10px', 'z-index:1100',
      'width:42px', 'height:42px', 'border-radius:11px',
      'border:1px solid rgba(245,197,66,0.3)', 'background:#0e1628',
      'color:#f5c542', 'font-size:19px', 'line-height:1', 'cursor:pointer',
      'display:none', 'align-items:center', 'justify-content:center',
      'box-shadow:0 6px 18px rgba(0,0,0,0.35)'
    ].join(';');

    var overlay = document.createElement('div');
    overlay.className = 'ten-mobile-nav-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:999',
      'background:rgba(4,8,18,0.6)', 'display:none'
    ].join(';');

    function open() {
      sidebar.classList.add('open');
      overlay.style.display = 'block';
      btn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';   // don't scroll the page behind the drawer
    }
    function close() {
      sidebar.classList.remove('open');
      overlay.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    btn.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) close(); else open();
    });
    overlay.addEventListener('click', close);

    // Choosing a destination should close the drawer, or the new page is
    // hidden behind it.
    sidebar.addEventListener('click', function (e) {
      var hit = e.target.closest ? e.target.closest('a, button, .nav-item') : null;
      if (hit) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    document.body.appendChild(overlay);
    document.body.appendChild(btn);

    function sync() {
      var small = window.innerWidth <= BREAKPOINT;
      btn.style.display = small ? 'flex' : 'none';
      if (!small) close();
    }
    sync();
    window.addEventListener('resize', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
