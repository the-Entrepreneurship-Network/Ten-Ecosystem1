/**
 * "An admin reset your access — set your own password."
 *
 * When a student cannot get into their account, an admin can set working
 * credentials for them. That gets them back in, and leaves the account sitting
 * on a password somebody else chose and knows, and possibly an email address
 * somebody else typed. Neither should be permanent.
 *
 * So the reset raises a flag, and this is what clears it. On any signed-in
 * student page it asks the server whether anything is outstanding and, if so,
 * puts up a panel with the relevant steps:
 *
 *   1. Choose your own password.       (when the admin reset the password)
 *   2. Confirm or correct your email.  (when the admin changed the email)
 *
 * Only the steps that apply are shown — an admin fixing a typo in an email has
 * not touched the password, and vice versa.
 *
 * The panel cannot be dismissed. A student who closes it is back where they
 * started, on credentials a third party holds; and because the flags live on
 * the record rather than in this page, reloading or opening another tab brings
 * it straight back. There is a sign-out link for anyone who would rather deal
 * with it later.
 *
 * Include after session-guard.js on signed-in student pages.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;
  if (window.__tenCredentialReset) return;
  window.__tenCredentialReset = true;

  var state = null;      // the server's answer
  var busy = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function api(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.success === false) {
          var err = new Error(d.message || 'Something went wrong. Please try again.');
          err.field = d.field;
          throw err;
        }
        return d;
      });
    });
  }

  function whenText() {
    if (!state || !state.resetAt) return '';
    try {
      var d = new Date(state.resetAt);
      return ' on ' + d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return ''; }
  }

  function injectStyles() {
    if (document.getElementById('tcr-styles')) return;
    var css = [
      '#tcr-overlay{position:fixed;inset:0;background:rgba(4,8,18,.92);backdrop-filter:blur(6px);',
      'z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;',
      "font-family:'Plus Jakarta Sans','Segoe UI',system-ui,sans-serif;overflow-y:auto;}",
      '#tcr-card{background:#0c1220;border:1px solid rgba(212,175,55,.28);border-radius:18px;',
      'width:100%;max-width:520px;padding:26px;color:#e2e8f0;box-shadow:0 30px 80px rgba(0,0,0,.7);',
      'max-height:92dvh;overflow-y:auto;}',
      '#tcr-card h2{margin:0 0 6px;font-size:20px;font-weight:800;color:#D4AF37;}',
      '#tcr-card .tcr-lede{margin:0 0 20px;font-size:13.5px;line-height:1.6;color:#94a3b8;}',
      '.tcr-step{border:1px solid #1e293b;border-radius:14px;padding:16px;margin-bottom:14px;background:#0a101d;}',
      '.tcr-step h3{margin:0 0 4px;font-size:15px;font-weight:700;color:#f1f5f9;}',
      '.tcr-step p{margin:0 0 12px;font-size:12.5px;line-height:1.55;color:#8aa4c8;}',
      '.tcr-step label{display:block;font-size:11.5px;font-weight:600;color:#94a3b8;margin:0 0 5px;',
      'text-transform:uppercase;letter-spacing:.05em;}',
      '.tcr-step input{width:100%;box-sizing:border-box;min-height:44px;padding:11px 13px;margin-bottom:11px;',
      'background:#070c17;border:1px solid #1e293b;border-radius:10px;color:#e2e8f0;font-size:16px;',
      'font-family:inherit;}',
      '.tcr-step input:focus{outline:none;border-color:#D4AF37;}',
      '.tcr-step input.bad{border-color:#f43f5e;}',
      '.tcr-btn{width:100%;min-height:46px;border:none;border-radius:10px;background:#D4AF37;color:#0a1222;',
      'font-weight:800;font-size:14.5px;font-family:inherit;cursor:pointer;}',
      '.tcr-btn[disabled]{opacity:.55;cursor:default;}',
      '.tcr-btn.secondary{background:#111a2e;color:#cbd5e1;border:1px solid #1e293b;font-weight:600;margin-top:8px;}',
      '.tcr-msg{font-size:12.5px;margin:0 0 10px;line-height:1.5;min-height:0;}',
      '.tcr-msg.err{color:#f87171;}',
      '.tcr-msg.ok{color:#34d399;}',
      '.tcr-done{border-color:rgba(52,211,153,.35);}',
      '.tcr-done h3::after{content:" ✓";color:#34d399;}',
      '#tcr-signout{display:block;text-align:center;margin-top:6px;font-size:12px;color:#64748b;',
      'text-decoration:underline;cursor:pointer;background:none;border:none;width:100%;font-family:inherit;}',
      '@media (max-width:480px){#tcr-card{padding:20px 16px;}}'
    ].join('');
    var el = document.createElement('style');
    el.id = 'tcr-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function passwordStep() {
    if (!state.mustChangePassword) return '';
    return '' +
      '<div class="tcr-step" id="tcr-pw">' +
        '<h3>1. Choose your own password</h3>' +
        '<p>The password you just signed in with was set for you. Pick one only you know — ' +
        'at least ' + (state.minPasswordLength || 8) + ' characters.</p>' +
        '<p class="tcr-msg" id="tcr-pw-msg"></p>' +
        '<label for="tcr-pw-new">New password</label>' +
        '<input id="tcr-pw-new" type="password" autocomplete="new-password" placeholder="Your new password">' +
        '<label for="tcr-pw-confirm">Confirm new password</label>' +
        '<input id="tcr-pw-confirm" type="password" autocomplete="new-password" placeholder="Type it again">' +
        '<button class="tcr-btn" id="tcr-pw-save">Save password</button>' +
      '</div>';
  }

  function emailStep() {
    if (!state.mustChangeEmail) return '';
    var n = state.mustChangePassword ? '2' : '1';
    var previous = state.previousEmail
      ? '<p>It was previously <strong>' + esc(state.previousEmail) + '</strong>.</p>'
      : '';
    return '' +
      '<div class="tcr-step" id="tcr-em">' +
        '<h3>' + n + '. Check your email address</h3>' +
        '<p>Your email was updated to <strong>' + esc(state.email || '') + '</strong>. ' +
        'This is where password resets and your certificates are sent, so it needs to be one you can open.</p>' +
        previous +
        '<p class="tcr-msg" id="tcr-em-msg"></p>' +
        '<label for="tcr-em-new">Email address</label>' +
        '<input id="tcr-em-new" type="email" autocomplete="email" value="' + esc(state.email || '') + '">' +
        '<button class="tcr-btn" id="tcr-em-save">Save email</button>' +
        '<button class="tcr-btn secondary" id="tcr-em-keep">That address is correct</button>' +
      '</div>';
  }

  function render() {
    injectStyles();
    var overlay = document.getElementById('tcr-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'tcr-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      document.body.appendChild(overlay);
    }

    var by = state.resetBy ? ' by ' + esc(state.resetBy) : '';
    overlay.innerHTML =
      '<div id="tcr-card">' +
        '<h2>Finish setting up your account</h2>' +
        '<p class="tcr-lede">Your sign-in details were reset' + by + whenText() +
        ' so you could get back in. Set your own before you carry on — it only takes a moment.</p>' +
        passwordStep() +
        emailStep() +
        '<button id="tcr-signout" type="button">Sign out and do this later</button>' +
      '</div>';

    document.body.style.overflow = 'hidden';
    wire();
    var first = overlay.querySelector('input');
    if (first) { try { first.focus(); } catch (e) {} }
  }

  function say(id, text, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'tcr-msg' + (kind ? ' ' + kind : '');
  }

  function mark(id, bad) {
    var el = document.getElementById(id);
    if (el) el.classList[bad ? 'add' : 'remove']('bad');
  }

  function finishIfDone() {
    if (state.mustChangePassword || state.mustChangeEmail) {
      render();
      return;
    }
    // Everything is settled — take the panel away and let the page be used.
    var overlay = document.getElementById('tcr-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.style.overflow = '';
  }

  function wire() {
    var pwBtn = document.getElementById('tcr-pw-save');
    if (pwBtn) {
      pwBtn.addEventListener('click', function () {
        if (busy) return;
        var np = document.getElementById('tcr-pw-new').value;
        var cp = document.getElementById('tcr-pw-confirm').value;
        mark('tcr-pw-new', false); mark('tcr-pw-confirm', false);
        say('tcr-pw-msg', '');

        busy = true; pwBtn.disabled = true; pwBtn.textContent = 'Saving…';
        api('/api/student/security/password', { newPassword: np, confirmPassword: cp })
          .then(function () {
            state.mustChangePassword = false;
            finishIfDone();
          })
          .catch(function (e) {
            say('tcr-pw-msg', e.message, 'err');
            if (e.field === 'confirmPassword') mark('tcr-pw-confirm', true);
            else mark('tcr-pw-new', true);
          })
          .then(function () {
            busy = false;
            var b = document.getElementById('tcr-pw-save');
            if (b) { b.disabled = false; b.textContent = 'Save password'; }
          });
      });
    }

    function saveEmail(keepCurrent) {
      if (busy) return;
      var btn = document.getElementById(keepCurrent ? 'tcr-em-keep' : 'tcr-em-save');
      var value = (document.getElementById('tcr-em-new') || {}).value || '';
      mark('tcr-em-new', false);
      say('tcr-em-msg', '');

      busy = true; btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = 'Saving…';
      api('/api/student/security/email', keepCurrent ? { keepCurrent: true } : { newEmail: value })
        .then(function () {
          state.mustChangeEmail = false;
          finishIfDone();
        })
        .catch(function (e) {
          say('tcr-em-msg', e.message, 'err');
          mark('tcr-em-new', true);
        })
        .then(function () {
          busy = false;
          var b = document.getElementById(keepCurrent ? 'tcr-em-keep' : 'tcr-em-save');
          if (b) { b.disabled = false; b.textContent = original; }
        });
    }

    var emSave = document.getElementById('tcr-em-save');
    if (emSave) emSave.addEventListener('click', function () { saveEmail(false); });
    var emKeep = document.getElementById('tcr-em-keep');
    if (emKeep) emKeep.addEventListener('click', function () { saveEmail(true); });

    var out = document.getElementById('tcr-signout');
    if (out) {
      out.addEventListener('click', function () {
        fetch('/logout', { method: 'POST', credentials: 'same-origin' })
          .catch(function () {})
          .then(function () { window.location.href = '/login.html'; });
      });
    }
  }

  function check() {
    fetch('/api/student/security/status', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.success) return;
        if (!d.mustChangePassword && !d.mustChangeEmail) return;
        state = d;
        render();
      })
      .catch(function () {
        // A page that cannot reach the server has bigger problems than this
        // prompt, and blocking it on a network blip would lock people out of a
        // portal they are entitled to use.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();
