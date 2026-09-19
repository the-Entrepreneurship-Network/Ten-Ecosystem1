/*
 * The LinkedIn section, as it appears in every portal — student, HR,
 * coordinator, mentor, founder, investor, contractor.
 *
 * It shows one thing: the posts the company page has published, newest first,
 * each with its poster and its full text. There is no text box, no send
 * button, no poster picker and no publish action, because there is nothing
 * here for a person to do — the agent posts one internship opening every two
 * hours by itself, round the clock. The section is a window onto what was said,
 * which is why it is the same for a first-week intern as for the founder:
 * everything in it is already public on LinkedIn.
 *
 * Three things it is careful about.
 *
 * `mount()` is called again every time the section is opened, in eight portals
 * that each re-run their own mount logic on every switch. So it is idempotent:
 * the same host element mounted twice re-renders rather than stacking a second
 * copy underneath the first.
 *
 * A server with no LinkedIn token still records every post and simply never
 * sends it. Those come back flagged, and a flagged post is labelled "not on
 * LinkedIn yet" rather than quietly counted among the ones the public saw.
 *
 * Nothing from the server is interpolated as HTML. The post text is written
 * with textContent, one node per line — a post is plain text with line breaks,
 * and building it out of text nodes is both the correct rendering and the one
 * that cannot become markup.
 */
(function () {
  'use strict';

  var API = '/api/v2/linkedin';
  var CSS_ID = 'ten-linkedin-agent-css';

  /* How much of a post is shown before "Show more". Roughly the fold LinkedIn
     itself uses, so a post that is short enough to show whole there is short
     enough to show whole here. */
  var FOLD = 320;

  var CSS = [
    '.la{color:#e8eaf0;font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.la *{box-sizing:border-box}',
    '.la-head{margin-bottom:18px}',
    '.la-title{font-size:19px;font-weight:700;letter-spacing:-.01em;margin:0 0 4px}',
    '.la-sub{margin:0;font-size:13px;color:#98a2b8}',
    '.la-note{border-radius:12px;padding:11px 14px;font-size:13px;margin-bottom:16px;border:1px solid}',
    '.la-note-warn{background:rgba(227,178,60,.09);border-color:rgba(227,178,60,.35);color:#f0d492}',
    '.la-feed{display:grid;gap:16px}',
    '.la-post{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);border-radius:16px;overflow:hidden}',
    '.la-post-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:13px 16px 0}',
    '.la-dom{font-weight:650;font-size:14px}',
    '.la-when{font-size:12px;color:#98a2b8}',
    '.la-pill{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid;white-space:nowrap}',
    '.la-p-live{color:#9fe3c0;border-color:rgba(52,199,123,.4);background:rgba(52,199,123,.12)}',
    '.la-p-draft{color:#f0d492;border-color:rgba(227,178,60,.4);background:rgba(227,178,60,.11)}',
    '.la-text{padding:11px 16px 13px;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.62}',
    '.la-more{background:none;border:0;padding:0;margin-top:6px;color:#7ca0ff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;display:block}',
    '.la-more:hover{text-decoration:underline}',
    '.la-more:focus-visible{outline:2px solid #7ca0ff;outline-offset:3px;border-radius:4px}',
    '.la-img{display:block;width:100%;height:auto;border-top:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03)}',
    '.la-foot{display:flex;justify-content:flex-end;padding:11px 16px;border-top:1px solid rgba(255,255,255,.07)}',
    '.la-link{color:#7ca0ff;text-decoration:none;font-size:13px;font-weight:600}',
    '.la-link:hover{text-decoration:underline}',
    '.la-link:focus-visible{outline:2px solid #7ca0ff;outline-offset:3px;border-radius:4px}',
    '.la-empty{color:#98a2b8;font-size:13px;padding:20px;border:1px dashed rgba(255,255,255,.13);border-radius:14px;text-align:center}',
    '.la-err{color:#ffb3ae;font-size:13px;padding:14px;border:1px solid rgba(255,107,98,.35);background:rgba(255,107,98,.08);border-radius:12px}',
    '.la-connect-head{margin-bottom:10px}',
    '.la-connect-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
    '.la-input{flex:1;min-width:220px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.16);border-radius:9px;padding:8px 11px;color:#e8eaf0;font:inherit;font-size:13px}',
    '.la-input:focus{outline:2px solid #7ca0ff;outline-offset:1px}',
    '.la-btn{background:rgba(124,160,255,.16);border:1px solid rgba(124,160,255,.4);color:#c9d8ff;border-radius:9px;padding:8px 15px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
    '.la-btn:hover:not(:disabled){background:rgba(124,160,255,.26)}',
    '.la-btn:disabled{opacity:.55;cursor:default}',
    '.la-btn:focus-visible{outline:2px solid #7ca0ff;outline-offset:2px}',
    '.la-connect-msg{font-size:12.5px;min-height:1.2em}',
    '.la-hints{margin:8px 0 0;padding-left:18px;font-size:12.5px;line-height:1.55}',
  ].join('\n');

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var el = document.createElement('style');
    el.id = CSS_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  /*
   * Dates are shown in IST, because the rotation is timed in IST and everybody
   * reading this is in the same office hours. A reader seeing 04:30 against a
   * 10:00 post would reasonably conclude something had gone wrong.
   */
  function istText(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      });
    } catch (e) {
      return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
  }

  /**
   * The post body, folded if it is long.
   *
   * The full text is in the DOM from the start rather than fetched on expand:
   * it is already loaded, and a "Show more" that needs the network is a "Show
   * more" that fails on a train. Folding is done by swapping the text content
   * of one node, so there is no second copy to keep in step.
   */
  function textBlock(text) {
    var box = el('div', 'la-text');
    var full = String(text || '');
    var body = el('span');

    if (full.length <= FOLD) {
      body.textContent = full;
      box.appendChild(body);
      return box;
    }

    /* Cut at a line break if there is one near the fold, so the teaser ends
       somewhere a person would have paused rather than mid-sentence. */
    var cut = full.lastIndexOf('\n', FOLD);
    if (cut < FOLD * 0.6) cut = full.lastIndexOf(' ', FOLD);
    if (cut < 1) cut = FOLD;
    var teaser = full.slice(0, cut).replace(/\s+$/, '') + '…';

    var open = false;
    var more = el('button', 'la-more', 'Show more');
    more.setAttribute('type', 'button');
    more.setAttribute('aria-expanded', 'false');
    body.textContent = teaser;

    more.addEventListener('click', function () {
      open = !open;
      body.textContent = open ? full : teaser;
      more.textContent = open ? 'Show less' : 'Show more';
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    box.appendChild(body);
    box.appendChild(more);
    return box;
  }

  function postCard(p) {
    var card = el('article', 'la-post');

    var top = el('div', 'la-post-top');
    if (p.domain) top.appendChild(el('span', 'la-dom', p.domain));
    /* A post that was recorded but never sent must not look like one the
       public saw. Saying which is which is the whole reason for the badge. */
    top.appendChild(p.live
      ? el('span', 'la-pill la-p-live', 'Posted')
      : el('span', 'la-pill la-p-draft', 'Not on LinkedIn yet'));
    var when = istText(p.at);
    if (when) top.appendChild(el('span', 'la-when', when));
    card.appendChild(top);

    card.appendChild(textBlock(p.text));

    if (p.image) {
      var img = el('img', 'la-img');
      img.src = p.image;
      /* The poster is the post: it carries the role, the stipend and the
         eligibility, none of which a screen reader can read off a JPEG. */
      img.alt = p.alt || ('Hiring poster' + (p.domain ? ' for ' + p.domain : ''));
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); };
      card.appendChild(img);
    }

    if (p.url) {
      var foot = el('div', 'la-foot');
      var a = el('a', 'la-link', 'View on LinkedIn');
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      foot.appendChild(a);
      card.appendChild(foot);
    }
    return card;
  }

  /**
   * The form that connects the page, for HR and admin only.
   *
   * It exists because the other two routes both need a shell on the
   * production box — a token in .env, or the OAuth pair in .env before the
   * handshake can even start — and asking somebody to SSH in to paste one
   * value is how a feature stays switched off for a fortnight.
   *
   * The field is type="password" so the token is not left on screen, and the
   * value is read once on submit and never written anywhere else: not into
   * localStorage, not into the URL, not into a data attribute.
   */
  function connectPanel(host, opts) {
    var box = el('div', 'la-note la-note-warn');
    box.appendChild(el('div', 'la-connect-head',
      'The company page is not connected, so the agent is writing these posts and not sending them.'));

    var row = el('div', 'la-connect-row');
    var input = el('input', 'la-input');
    input.type = 'password';
    input.placeholder = 'Paste the LinkedIn access token';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-label', 'LinkedIn access token');

    var go = el('button', 'la-btn', 'Connect');
    go.setAttribute('type', 'button');

    var say = el('div', 'la-connect-msg');

    function attempt(orgId) {
      var token = String(input.value || '').trim();
      if (!token) { say.textContent = 'Paste the token first.'; return; }

      go.disabled = true;
      say.textContent = 'Checking with LinkedIn…';

      var init = {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgId ? { token: token, orgId: orgId } : { token: token }),
      };
      if (opts && opts.headers) {
        Object.keys(opts.headers).forEach(function (k) {
          if (opts.headers[k]) init.headers[k] = opts.headers[k];
        });
      }

      fetch(API + '/connect', init)
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (res) {
          var b = res.body || {};
          if (b.ok) {
            /* Clear it from the field the moment it is no longer needed. */
            input.value = '';
            say.textContent = 'Connected. Loading…';
            mount(host, opts);
            return;
          }

          go.disabled = false;

          /* More than one page: ask which, rather than guessing which company
             the agent should speak as. */
          if (res.status === 409 && b.pages && b.pages.length) {
            say.textContent = 'This token administers more than one page. Choose:';
            var pick = el('div', 'la-connect-row');
            b.pages.forEach(function (p) {
              var btn = el('button', 'la-btn', p.orgId);
              btn.setAttribute('type', 'button');
              btn.addEventListener('click', function () { attempt(p.orgId); });
              pick.appendChild(btn);
            });
            box.appendChild(pick);
            return;
          }

          say.textContent = b.error || 'That did not work.';
          if (b.hints && b.hints.length) {
            var ul = el('ul', 'la-hints');
            b.hints.forEach(function (hint) { ul.appendChild(el('li', null, hint)); });
            box.appendChild(ul);
          }
        })
        .catch(function () {
          go.disabled = false;
          say.textContent = 'The server could not be reached.';
        });
    }

    go.addEventListener('click', function () { attempt(''); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); attempt(''); }
    });

    row.appendChild(input);
    row.appendChild(go);
    box.appendChild(row);
    box.appendChild(say);
    return box;
  }

  function render(host, data, opts) {
    host.textContent = '';
    var posts = (data && data.posts) || [];
    var count = data && typeof data.count === 'number' ? data.count : posts.length;

    var wrap = el('div', 'la');

    var head = el('div', 'la-head');
    head.appendChild(el('h3', 'la-title', 'LinkedIn Agent'));
    head.appendChild(el('p', 'la-sub', count === 0
      ? 'Everything The Entrepreneurship Network has posted to LinkedIn will appear here.'
      : count + (count === 1 ? ' post' : ' posts') + ' published to The Entrepreneurship Network'
        + ' so far. A new internship opening goes out every two hours, by itself.'));
    wrap.appendChild(head);

    /* Only HR and admin are sent these fields, so only they ever see this. */
    if (data && data.canConnect && data.connected === false) {
      wrap.appendChild(connectPanel(host, opts));
    }

    if (!posts.length) {
      wrap.appendChild(el('div', 'la-empty',
        'Nothing has gone out yet. The first post lands within the next two hours.'));
      host.appendChild(wrap);
      return;
    }

    var feed = el('div', 'la-feed');
    posts.forEach(function (p) { feed.appendChild(postCard(p)); });
    wrap.appendChild(feed);
    host.appendChild(wrap);
  }

  function renderError(host, message) {
    host.textContent = '';
    var wrap = el('div', 'la');
    wrap.appendChild(el('h3', 'la-title', 'LinkedIn Agent'));
    wrap.appendChild(el('div', 'la-err', message));
    host.appendChild(wrap);
  }

  function mount(host, options) {
    if (!host) return;
    injectCss();
    var opts = options || {};
    host.textContent = '';
    var loading = el('div', 'la');
    loading.appendChild(el('h3', 'la-title', 'LinkedIn Agent'));
    loading.appendChild(el('p', 'la-sub', 'Loading the posts…'));
    host.appendChild(loading);

    var init = { credentials: 'same-origin', headers: {} };
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) {
        if (opts.headers[k]) init.headers[k] = opts.headers[k];
      });
    }

    fetch(API + '/feed', init)
      .then(function (r) {
        if (r.status === 401) throw new Error('Your session has expired. Sign in again to see the posts.');
        if (r.status === 403) throw new Error('This section is not available on your account.');
        if (!r.ok) throw new Error('The posts could not be loaded (' + r.status + ').');
        return r.json();
      })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error) || 'The posts could not be loaded.');
        render(host, data, opts);
      })
      .catch(function (e) {
        renderError(host, e && e.message ? e.message : 'The posts could not be loaded.');
      });
  }

  window.TENLinkedInAgent = { mount: mount };
}());
