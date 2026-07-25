'use strict';
/* globals window, document */

(function initTENComponents() {
  /* ── TOAST ──────────────────────────────────────────────────── */
  const Toast = (function() {
    function getContainer() {
      let container = document.querySelector('.toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
      }
      return container;
    }

    const TYPE_ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    function show({ message, type, duration }) {
      const effectiveType     = type || 'info';
      const effectiveDuration = typeof duration === 'number' ? duration : 4000;
      const container         = getContainer();

      const toast = document.createElement('div');
      toast.className = `toast toast--${effectiveType}`;
      toast.innerHTML = [
        `<span class="toast__icon">${TYPE_ICONS[effectiveType] || '🔔'}</span>`,
        `<span class="toast__message">${message}</span>`,
      ].join('');

      container.appendChild(toast);

      setTimeout(function() {
        toast.classList.add('is-leaving');
        setTimeout(function() {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 350);
      }, effectiveDuration);
    }

    return { show };
  }());

  /* ── MODAL ──────────────────────────────────────────────────── */
  const Modal = (function() {
    function open(id) {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      overlay.classList.add('is-open');
      document.body.classList.add('modal--open');
    }

    function close(id) {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      overlay.classList.remove('is-open');
      document.body.classList.remove('modal--open');
    }

    function init() {
      document.addEventListener('click', function(e) {
        const trigger = e.target.closest('[data-modal-target]');
        if (trigger) {
          e.preventDefault();
          open(trigger.getAttribute('data-modal-target'));
        }
        const closer = e.target.closest('[data-modal-close]');
        if (closer) {
          const overlay = closer.closest('.modal-overlay');
          if (overlay) close(overlay.id);
        }
      });
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          const open_overlay = document.querySelector('.modal-overlay.is-open');
          if (open_overlay) close(open_overlay.id);
        }
      });
    }

    return { open, close, init };
  }());

  /* ── TABS ───────────────────────────────────────────────────── */
  const Tabs = (function() {
    function init(container) {
      const tabs   = container.querySelectorAll('.tab');
      const panels = container.querySelectorAll('.tab-panel');

      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          tabs.forEach(function(t)   { t.classList.remove('tab--active'); });
          panels.forEach(function(p) { p.classList.remove('tab-panel--active'); });
          tab.classList.add('tab--active');
          const target = document.getElementById(tab.getAttribute('data-tab'));
          if (target) target.classList.add('tab-panel--active');
        });
      });
    }

    return { init };
  }());

  /* ── SIDEBAR ─────────────────────────────────────────────────── */
  const Sidebar = (function() {
    function init() {
      document.addEventListener('click', function(e) {
        const trigger = e.target.closest('[data-sidebar-toggle]');
        const sidebar = document.querySelector('.sidebar');
        if (trigger) {
          if (sidebar) sidebar.classList.toggle('is-open');
        } else if (sidebar && sidebar.classList.contains('is-open')) {
          if (!sidebar.contains(e.target)) {
            sidebar.classList.remove('is-open');
          }
        }
      });

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          const sidebar = document.querySelector('.sidebar');
          if (sidebar && sidebar.classList.contains('is-open')) {
            sidebar.classList.remove('is-open');
          }
        }
      });
    }

    function setActiveItem() {
      const currentPath = window.location.pathname;
      document.querySelectorAll('.nav-item').forEach(function(item) {
        const href = item.getAttribute('href');
        if (href && (currentPath === href || currentPath.startsWith(href + '/'))) {
          item.classList.add('nav-item--active');
        } else {
          item.classList.remove('nav-item--active');
        }
      });
    }

    return { init, setActiveItem };
  }());

  /* ── TABLE ───────────────────────────────────────────────────── */
  const Table = (function() {
    function sortable(tableEl) {
      const headers = tableEl.querySelectorAll('th[data-sort]');
      headers.forEach(function(th) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function() {
          const col    = th.getAttribute('data-sort');
          const tbody  = tableEl.querySelector('tbody');
          if (!tbody) return;
          const rows   = Array.from(tbody.querySelectorAll('tr'));
          const asc    = th.getAttribute('data-dir') !== 'asc';

          headers.forEach(function(h) { h.removeAttribute('data-dir'); });
          th.setAttribute('data-dir', asc ? 'asc' : 'desc');

          const idx = Array.from(th.parentNode.children).indexOf(th);
          rows.sort(function(a, b) {
            const aVal = (a.children[idx] ? a.children[idx].textContent : '').trim();
            const bVal = (b.children[idx] ? b.children[idx].textContent : '').trim();
            const cmp  = aVal.localeCompare(bVal, undefined, { numeric: true });
            return asc ? cmp : -cmp;
          });
          rows.forEach(function(row) { tbody.appendChild(row); });
        });
      });
    }

    return { sortable };
  }());

  /* ── ROLE-BASED NAV VISIBILITY ───────────────────────────────── */
  function applyRoleVisibility() {
    const meta = document.querySelector('meta[name="current-user-role"]');
    const role = (meta && meta.getAttribute('content')) ||
                 (window.__USER__ && window.__USER__.role) || '';

    document.querySelectorAll('[data-roles]').forEach(function(el) {
      const allowed = el.getAttribute('data-roles').split(',').map(function(r) { return r.trim(); });
      if (role && !allowed.includes(role)) {
        el.style.display = 'none';
      }
    });
  }

  /* ── AUTO-INIT ───────────────────────────────────────────────── */
  function autoInit() {
    Modal.init();
    Sidebar.init();
    Sidebar.setActiveItem();
    applyRoleVisibility();
    document.querySelectorAll('[data-tabs-container]').forEach(function(container) {
      Tabs.init(container);
    });
    document.querySelectorAll('[data-sortable-table]').forEach(function(table) {
      Table.sortable(table);
    });
  }

  window.TEN = window.TEN || {};
  Object.assign(window.TEN, { Toast, Modal, Tabs, Sidebar, Table });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
}());
