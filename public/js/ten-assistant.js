/*
 * TEN Assistant — floating widget.
 *
 * Dropped onto a student page with one script tag. Everything it creates is
 * namespaced under #tenai-, it attaches no global handlers beyond one Escape
 * listener, and it reads existing storage without ever writing to it, so it
 * cannot disturb the page it is added to.
 *
 * It guards against double-inclusion, and it renders answers as plain text
 * nodes rather than innerHTML, so nothing the server returns can inject markup
 * into a page that carries a logged-in session.
 */
(function () {
  'use strict';
  if (window.__tenAssistantLoaded) { return; }
  window.__tenAssistantLoaded = true;

  var GOLD = '#D4AF37';
  var css = [
    '#tenai-fab{position:fixed;right:20px;bottom:20px;z-index:99990;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;',
    'background:linear-gradient(145deg,#F0D060,#B8960C);color:#05070E;font-size:26px;line-height:1;font-weight:700;',
    'box-shadow:0 6px 22px rgba(0,0,0,.4);transition:transform .18s cubic-bezier(.16,1,.3,1)}',
    '#tenai-fab:hover{transform:translateY(-2px) scale(1.05)}',
    '#tenai-fab:focus-visible{outline:3px solid ' + GOLD + ';outline-offset:3px}',
    '#tenai-panel{position:fixed;right:20px;bottom:88px;z-index:99991;width:min(390px,calc(100vw - 32px));',
    'height:min(540px,calc(100vh - 140px));display:none;flex-direction:column;background:#090D1A;',
    'border:1px solid rgba(212,175,55,.22);border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55);',
    'font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
    '#tenai-panel.tenai-open{display:flex}',
    '#tenai-top{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;background:#0E1428;border-bottom:1px solid rgba(212,175,55,.14)}',
    '#tenai-top strong{color:#F0EEE8;font-size:14px;font-weight:600;letter-spacing:.02em}',
    '#tenai-top small{display:block;color:#9A9080;font-size:11px;font-weight:400;margin-top:2px}',
    '#tenai-close{background:none;border:0;color:#9A9080;font-size:22px;line-height:1;cursor:pointer;padding:0 4px}',
    '#tenai-close:hover{color:#F0EEE8}',
    '#tenai-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:11px}',
    '.tenai-msg{max-width:90%;padding:10px 13px;border-radius:13px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word}',
    '.tenai-me{align-self:flex-end;background:rgba(212,175,55,.15);color:#F0EEE8;border:1px solid rgba(212,175,55,.2)}',
    '.tenai-it{align-self:flex-start;background:#0E1428;color:#E8E4DC;border:1px solid rgba(212,175,55,.1)}',
    '#tenai-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}',
    '.tenai-chip{background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.24);color:' + GOLD + ';',
    'border-radius:999px;padding:5px 11px;font-size:11.5px;cursor:pointer;font-family:inherit}',
    '.tenai-chip:hover{background:rgba(212,175,55,.2)}',
    '#tenai-form{display:flex;gap:8px;padding:11px;border-top:1px solid rgba(212,175,55,.12);background:#070B15}',
    '#tenai-input{flex:1;background:#05070E;border:1px solid rgba(212,175,55,.2);color:#F0EEE8;border-radius:10px;',
    'padding:10px 12px;font-size:13px;font-family:inherit;outline:none}',
    '#tenai-input:focus{border-color:rgba(212,175,55,.5)}',
    '#tenai-send{background:' + GOLD + ';color:#05070E;border:0;border-radius:10px;padding:0 15px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit}',
    '#tenai-send:disabled{opacity:.5;cursor:default}',
    '@media (prefers-reduced-motion:reduce){#tenai-fab{transition:none}}'
  ].join('');

  var style = document.createElement('style');
  style.id = 'tenai-style';
  style.textContent = css;
  document.head.appendChild(style);

  var fab = document.createElement('button');
  fab.id = 'tenai-fab';
  fab.type = 'button';
  fab.title = 'TEN Assistant';
  fab.setAttribute('aria-label', 'Open TEN Assistant');
  fab.textContent = '∞';

  var panel = document.createElement('div');
  panel.id = 'tenai-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'TEN Assistant');

  var top = document.createElement('div');
  top.id = 'tenai-top';
  var title = document.createElement('div');
  var strong = document.createElement('strong');
  strong.textContent = 'TEN Assistant';
  var sub = document.createElement('small');
  sub.textContent = 'Your tasks, tracks and coins';
  title.appendChild(strong);
  title.appendChild(sub);
  var close = document.createElement('button');
  close.id = 'tenai-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '&times;';
  top.appendChild(title);
  top.appendChild(close);

  var log = document.createElement('div');
  log.id = 'tenai-log';
  log.setAttribute('aria-live', 'polite');

  var chips = document.createElement('div');
  chips.id = 'tenai-chips';

  var form = document.createElement('form');
  form.id = 'tenai-form';
  var input = document.createElement('input');
  input.id = 'tenai-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = 'Ask about your tasks, coins, track…';
  input.setAttribute('aria-label', 'Ask the TEN Assistant');
  var send = document.createElement('button');
  send.id = 'tenai-send';
  send.type = 'submit';
  send.textContent = 'Send';
  form.appendChild(input);
  form.appendChild(send);

  panel.appendChild(top);
  panel.appendChild(log);
  panel.appendChild(chips);
  panel.appendChild(form);

  function mount() {
    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }
  if (document.body) { mount(); }
  else { document.addEventListener('DOMContentLoaded', mount); }

  function say(text, mine) {
    var d = document.createElement('div');
    d.className = 'tenai-msg ' + (mine ? 'tenai-me' : 'tenai-it');
    d.textContent = text; // text node, never innerHTML
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  /* Identify the student from whatever this portal already stored. Read-only:
     the widget never writes to storage and never alters existing state. */
  function who() {
    var o = { userId: '', userName: '', domain: '' };
    try {
      var idKeys = ['employeeId', 'employee_id', 'userId', 'studentId', 'empId'];
      for (var i = 0; i < idKeys.length; i++) {
        var v = localStorage.getItem(idKeys[i]);
        if (v) { o.userId = v; break; }
      }
      o.userName = localStorage.getItem('name') || localStorage.getItem('studentName') || '';
      o.domain   = localStorage.getItem('domain') || localStorage.getItem('studentDomain') || '';
      var raw = localStorage.getItem('student') || localStorage.getItem('user') || localStorage.getItem('studentData');
      if (raw) {
        var p = JSON.parse(raw);
        o.userId   = o.userId   || p.employeeId || p.userId || p._id || '';
        o.userName = o.userName || p.name || '';
        o.domain   = o.domain   || p.domain || '';
      }
    } catch (e) { /* storage blocked or malformed — degrade to anonymous */ }
    return o;
  }

  var busy = false;
  function ask(q) {
    if (busy || !q) { return; }
    busy = true;
    send.disabled = true;
    say(q, true);
    var pending = say('…', false);
    var me = who();

    fetch('/api/v2/assistant/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q,
        userId:   me.userId,
        userName: me.userName,
        domain:   me.domain
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        pending.textContent = d.answer || d.error || 'No answer available.';
      })
      .catch(function () {
        pending.textContent = 'Could not reach the assistant. Check your connection and try again.';
      })
      .then(function () {
        busy = false;
        send.disabled = false;
        log.scrollTop = log.scrollHeight;
      });
  }

  var SUGGESTIONS = ['My week-by-week plan', 'How do coins work?', 'All 14 domains', 'Certificates'];
  var SUGGESTION_Q = {
    'My week-by-week plan': 'Give me my week by week plan',
    'How do coins work?':   'How do coins work and how do I earn the most?',
    'All 14 domains':       'What are all the domains available?',
    'Certificates':         'What certificates does TEN issue and how do I qualify?'
  };

  var greeted = false;
  function openPanel() {
    panel.classList.add('tenai-open');
    fab.setAttribute('aria-label', 'Close TEN Assistant');
    if (!greeted) {
      greeted = true;
      var me = who();
      say(
        (me.userName ? 'Hi ' + me.userName + '. ' : 'Hi. ') +
        'Ask me about your weekly tasks, your track plan, coins, attendance, documents or certificates.' +
        (me.domain ? '\n\nYou are on ' + me.domain + '. Tell me your track — 1 Week, 15 Days, 1 Month, 45 Days, 3 Months or 6 Months.'
                   : '\n\nTry: "MERN 3 months".'),
        false
      );
      SUGGESTIONS.forEach(function (label) {
        var c = document.createElement('button');
        c.type = 'button';
        c.className = 'tenai-chip';
        c.textContent = label;
        c.addEventListener('click', function () { ask(SUGGESTION_Q[label]); });
        chips.appendChild(c);
      });
    }
    input.focus();
  }
  function closePanel() {
    panel.classList.remove('tenai-open');
    fab.setAttribute('aria-label', 'Open TEN Assistant');
  }

  fab.addEventListener('click', function () {
    panel.classList.contains('tenai-open') ? closePanel() : openPanel();
  });
  close.addEventListener('click', function () { closePanel(); fab.focus(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('tenai-open')) { closePanel(); fab.focus(); }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) { return; }
    input.value = '';
    ask(q);
  });
})();
