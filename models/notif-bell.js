/**
 * TenNotifBell — one reusable notification bell + inbox panel for every
 * portal page (student, coordinator, HR, and later founder/mentor/investor).
 *
 * Talks only to the existing /api/ecosystem-notifications endpoints:
 *   GET    /api/ecosystem-notifications
 *   PATCH  /api/ecosystem-notifications/:id/read
 *   PATCH  /api/ecosystem-notifications/read-all
 *   DELETE /api/ecosystem-notifications/:id
 *
 * Usage (drop into any page, once):
 *   <script src="/notif-bell.js"></script>
 *   <script>
 *     TenNotifBell.mount(document.getElementById('notifBellMount'), {
 *       identityHeaders: { 'x-employee-id': employeeId }
 *       // or: { 'x-hr-email': hrEmail }  /  { 'x-coordinator-email': coordEmail }
 *     });
 *   </script>
 *
 * `identityHeaders` is required — it's how the server-side
 * attachUserFromSession middleware resolves who's asking, since HR and
 * coordinator sessions carry no server-side identity today.
 */
(function (global) {
  'use strict';

  var POLL_MS = 30000;
  var API_BASE = '/api/ecosystem-notifications';

  var STYLE_ID = 'ten-notif-bell-styles';
  var CSS = [
    '.tnb-wrap{position:relative;display:inline-block;font-family:inherit;}',
    '.tnb-btn{position:relative;width:42px;height:42px;background:rgba(255,255,255,0.08);',
    'border:1px solid rgba(255,255,255,0.12);border-radius:12px;cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;font-size:20px;transition:all .2s;color:inherit;}',
    '.tnb-btn:hover{background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.22);}',
    '.tnb-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 4px;',
    'background:#ef4444;border-radius:9px;font-size:10px;font-weight:700;color:#fff;',
    'display:flex;align-items:center;justify-content:center;border:2px solid var(--tnb-bg,#05070e);}',
    '.tnb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99998;}',
    '.tnb-overlay.tnb-show{display:block;}',
    '.tnb-panel{position:fixed;top:0;right:-420px;bottom:0;width:min(400px,92vw);',
    'background:var(--tnb-bg,#090d1a);border-left:1px solid rgba(99,140,210,.15);z-index:99999;',
    'transition:right .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;',
    'box-shadow:-8px 0 40px rgba(0,0,0,.5);color:var(--tnb-fg,#F0EEE8);}',
    '.tnb-panel.tnb-open{right:0;}',
    '.tnb-head{padding:20px 18px 16px;border-bottom:1px solid rgba(99,140,210,.1);',
    'display:flex;align-items:center;justify-content:space-between;}',
    '.tnb-title{font-size:16px;font-weight:700;}',
    '.tnb-actions{display:flex;gap:8px;align-items:center;}',
    '.tnb-link-btn{background:none;border:none;color:#8aa4c8;font-size:12px;cursor:pointer;',
    'text-decoration:underline;padding:4px;}',
    '.tnb-close{width:30px;height:30px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);',
    'border-radius:8px;cursor:pointer;color:inherit;font-size:14px;display:flex;align-items:center;justify-content:center;}',
    '.tnb-scroll{flex:1;overflow-y:auto;padding:10px 14px;}',
    '.tnb-item{background:var(--tnb-card,rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.08);',
    'border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;position:relative;transition:border-color .2s;}',
    '.tnb-item:hover{border-color:rgba(255,255,255,.2);}',
    '.tnb-item.tnb-unread{border-left:3px solid #3b82f6;}',
    '.tnb-item.tnb-type-payment_confirmed,.tnb-item.tnb-type-profile_approved,.tnb-item.tnb-type-task_approved,',
    '.tnb-item.tnb-type-certificate_ready{border-left-color:#10b981;}',
    '.tnb-item.tnb-type-payment_failed,.tnb-item.tnb-type-profile_rejected,.tnb-item.tnb-type-task_rejected{border-left-color:#f59e0b;}',
    '.tnb-item-title{font-size:13px;font-weight:700;margin-bottom:4px;}',
    '.tnb-item-msg{font-size:12px;opacity:.75;line-height:1.5;}',
    '.tnb-item-time{font-size:11px;opacity:.5;margin-top:6px;}',
    '.tnb-del{position:absolute;top:8px;right:8px;background:none;border:none;color:#ef4444;',
    'opacity:.5;cursor:pointer;font-size:14px;padding:2px 6px;}',
    '.tnb-del:hover{opacity:1;}',
    '.tnb-empty{text-align:center;padding:60px 20px;opacity:.5;}',
    '.tnb-empty .tnb-ei{font-size:36px;margin-bottom:10px;}'
  ].join('');

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return ''; }
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('Request failed: ' + r.status);
      return r.json();
    });
  }

  function Bell(container, opts) {
    this.container = container;
    this.identityHeaders = opts.identityHeaders || {};
    this.data = [];
    this.unread = 0;
    this.open = false;
    this._pollTimer = null;
    this._build();
    this.refresh();
    this._pollTimer = setInterval(this.refresh.bind(this), POLL_MS);
  }

  Bell.prototype._build = function () {
    injectStyles();
    this.container.innerHTML =
      '<div class="tnb-wrap">' +
        '<button class="tnb-btn" type="button" aria-label="Notifications">🔔<span class="tnb-badge" style="display:none;">0</span></button>' +
      '</div>';
    this.btn = this.container.querySelector('.tnb-btn');
    this.badge = this.container.querySelector('.tnb-badge');

    this.overlay = document.createElement('div');
    this.overlay.className = 'tnb-overlay';
    document.body.appendChild(this.overlay);

    this.panel = document.createElement('div');
    this.panel.className = 'tnb-panel';
    this.panel.innerHTML =
      '<div class="tnb-head">' +
        '<div class="tnb-title">🔔 Notifications</div>' +
        '<div class="tnb-actions">' +
          '<button class="tnb-link-btn" type="button" data-act="read-all">Mark all read</button>' +
          '<button class="tnb-close" type="button">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="tnb-scroll"></div>';
    document.body.appendChild(this.panel);
    this.scroll = this.panel.querySelector('.tnb-scroll');

    var self = this;
    this.btn.addEventListener('click', function () { self.toggle(); });
    this.overlay.addEventListener('click', function () { self.close(); });
    this.panel.querySelector('.tnb-close').addEventListener('click', function () { self.close(); });
    this.panel.querySelector('[data-act="read-all"]').addEventListener('click', function () { self.markAllRead(); });
  };

  Bell.prototype.toggle = function () { this.open ? this.close() : this.openPanel(); };

  Bell.prototype.openPanel = function () {
    this.open = true;
    this.panel.classList.add('tnb-open');
    this.overlay.classList.add('tnb-show');
    this.refresh();
  };

  Bell.prototype.close = function () {
    this.open = false;
    this.panel.classList.remove('tnb-open');
    this.overlay.classList.remove('tnb-show');
  };

  Bell.prototype.refresh = function () {
    var self = this;
    return api('/?limit=30', { headers: this.identityHeaders })
      .then(function (d) {
        self.data = d.data || [];
        self.unread = d.unreadCount || 0;
        self._render();
      })
      .catch(function (e) { console.warn('[TenNotifBell] refresh failed:', e.message); });
  };

  Bell.prototype._render = function () {
    if (this.unread > 0) {
      this.badge.style.display = 'flex';
      this.badge.textContent = this.unread > 99 ? '99+' : this.unread;
    } else {
      this.badge.style.display = 'none';
    }

    if (!this.data.length) {
      this.scroll.innerHTML = '<div class="tnb-empty"><div class="tnb-ei">🔔</div><p>No notifications yet</p></div>';
      return;
    }

    var self = this;
    this.scroll.innerHTML = this.data.map(function (n) {
      var unreadCls = n.isRead ? '' : ' tnb-unread';
      var typeCls = ' tnb-type-' + esc(n.type || '');
      return (
        '<div class="tnb-item' + unreadCls + typeCls + '" data-id="' + n._id + '">' +
          '<button class="tnb-del" type="button" data-id="' + n._id + '" title="Delete">🗑</button>' +
          '<div class="tnb-item-title">' + esc(n.title) + '</div>' +
          '<div class="tnb-item-msg">' + esc(n.message) + '</div>' +
          '<div class="tnb-item-time">' + fmtTime(n.createdAt) + '</div>' +
        '</div>'
      );
    }).join('');

    this.scroll.querySelectorAll('.tnb-item').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.tnb-del')) return;
        var id = el.getAttribute('data-id');
        var n = self.data.find(function (x) { return x._id === id; });
        if (n && n.link) window.location.href = n.link;
        self.markRead(id);
      });
    });
    this.scroll.querySelectorAll('.tnb-del').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        self.remove(el.getAttribute('data-id'));
      });
    });
  };

  Bell.prototype.markRead = function (id) {
    var self = this;
    return api('/' + id + '/read', { method: 'PATCH', headers: this.identityHeaders })
      .then(function () { return self.refresh(); })
      .catch(function (e) { console.warn('[TenNotifBell] markRead failed:', e.message); });
  };

  Bell.prototype.markAllRead = function () {
    var self = this;
    return api('/read-all', { method: 'PATCH', headers: this.identityHeaders })
      .then(function () { return self.refresh(); })
      .catch(function (e) { console.warn('[TenNotifBell] markAllRead failed:', e.message); });
  };

  Bell.prototype.remove = function (id) {
    var self = this;
    return api('/' + id, { method: 'DELETE', headers: this.identityHeaders })
      .then(function () { return self.refresh(); })
      .catch(function (e) { console.warn('[TenNotifBell] remove failed:', e.message); });
  };

  Bell.prototype.destroy = function () {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
  };

  global.TenNotifBell = {
    mount: function (container, opts) {
      if (!container) { console.error('[TenNotifBell] mount() needs a container element'); return null; }
      return new Bell(container, opts || {});
    }
  };
})(window);