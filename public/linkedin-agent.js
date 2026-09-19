/*
 * The LinkedIn section, as it appears in every portal — student, HR,
 * coordinator, mentor, founder, investor, contractor, admin.
 *
 * It shows the fourteen internship openings: the poster for each, and the post
 * that goes with it. Two buttons per opening — copy the words, download the
 * picture — and that is all it does. A person takes both and posts them from
 * their own LinkedIn account.
 *
 * This replaced a read-only feed of posts a bot had published to the company
 * page. The bot is gone: automated posting is what gets a company page
 * restricted, and the page is where the applications come from. What is left
 * is better distribution anyway. One company page posting an opening reaches
 * the people who already follow it; fourteen interns posting the same opening
 * reach fourteen networks of exactly the students the opening is for.
 *
 * Four things it is careful about.
 *
 * `mount()` is called again every time the section is opened, in eight portals
 * that each re-run their own mount logic on every switch. So it is idempotent:
 * the same host element mounted twice re-renders rather than stacking a second
 * copy underneath the first.
 *
 * A domain can have one poster or two. The second set — the TEN-building
 * variant — is not committed yet, so the server sends whichever plates exist
 * and this file renders what it is given. It never assumes two, and it never
 * renders an <img> for a file that is not there.
 *
 * Copying has to work on http://, not just https://. `navigator.clipboard` is
 * undefined on an insecure origin, which is exactly what a coordinator hitting
 * the box by IP on the office network is on, so there is a textarea fallback.
 * A copy button that silently does nothing is worse than no copy button.
 *
 * Nothing from the server is interpolated as HTML. The post text is written
 * with textContent — a post is plain text with line breaks, and building it
 * out of text nodes is both the correct rendering and the one that cannot
 * become markup.
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
    '.la-feed{display:grid;gap:18px}',
    '.la-post{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);border-radius:16px;overflow:hidden}',
    '.la-post-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 16px 0}',
    '.la-dom{font-weight:650;font-size:15px}',
    '.la-role{font-size:12px;color:#98a2b8}',
    /* Plates sit side by side on a wide card and stack on a narrow one. auto-fit
       rather than a fixed count, so a domain with one poster gets a full-width
       plate instead of a half-width one with a hole beside it. */
    '.la-plates{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;padding:13px 16px 0}',
    '.la-plate{border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.03);display:flex;flex-direction:column}',
    '.la-img{display:block;width:100%;height:auto}',
    '.la-dl{display:block;text-align:center;padding:9px 10px;font-size:12px;font-weight:650;color:#7ca0ff;text-decoration:none;border-top:1px solid rgba(255,255,255,.07)}',
    '.la-dl:hover{background:rgba(124,160,255,.1);text-decoration:underline}',
    '.la-dl:focus-visible{outline:2px solid #7ca0ff;outline-offset:-2px}',
    '.la-text{padding:13px 16px 0;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.62}',
    '.la-more{background:none;border:0;padding:0;margin-top:6px;color:#7ca0ff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;display:block}',
    '.la-more:hover{text-decoration:underline}',
    '.la-more:focus-visible{outline:2px solid #7ca0ff;outline-offset:3px;border-radius:4px}',
    '.la-acts{display:flex;gap:10px;flex-wrap:wrap;padding:13px 16px 15px}',
    '.la-btn{font:inherit;font-size:13px;font-weight:650;padding:8px 14px;border-radius:9px;cursor:pointer;border:1px solid rgba(124,160,255,.4);background:rgba(124,160,255,.12);color:#bcd0ff}',
    '.la-btn:hover{background:rgba(124,160,255,.2)}',
    '.la-btn:focus-visible{outline:2px solid #7ca0ff;outline-offset:2px}',
    '.la-btn-ok{border-color:rgba(52,199,123,.45);background:rgba(52,199,123,.14);color:#9fe3c0}',
    '.la-apply{font-size:12px;color:#98a2b8;align-self:center}',
    '.la-apply a{color:#7ca0ff}',
    '.la-err{border:1px solid rgba(255,107,107,.35);background:rgba(255,107,107,.09);color:#ffb3b3;border-radius:12px;padding:12px 14px;font-size:13px}',
  ].join('');

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var node = document.createElement('style');
    node.id = CSS_ID;
    node.textContent = CSS;
    document.head.appendChild(node);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  /**
   * Put text on the clipboard, and say whether it worked.
   *
   * `navigator.clipboard` is only defined on a secure origin. The portals are
   * reached over plain http on the office network often enough that treating
   * its absence as an error would break the one button this section exists
   * for, so the old `execCommand` path stays as the fallback. It needs the
   * textarea to be in the document and selectable, hence the off-screen
   * positioning rather than `display:none`, which cannot be selected.
   */
  function copyText(text) {
    var nav = typeof navigator === 'undefined' ? null : navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      return nav.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  /**
   * The post body, folded if it is long.
   *
   * The full text is in the DOM from the start rather than fetched on expand:
   * it is already loaded, and a "Show more" that needs the network is a "Show
   * more" that fails on a train. Folding is done by swapping the text content
   * of one node, so there is no second copy to keep in step — and the copy
   * button always copies the full text, never the teaser.
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

  /* One poster, with its own download link. The filename the browser saves
     under comes from the URL, which is already the domain slug, so a person
     downloading all fourteen gets fourteen distinguishable files rather than
     fourteen copies of "download.jpg". */
  function plate(poster, alt, name) {
    var box = el('div', 'la-plate');

    var img = el('img', 'la-img');
    img.src = poster.url;
    img.alt = alt || (name + ' hiring poster');
    img.loading = 'lazy';
    box.appendChild(img);

    var dl = el('a', 'la-dl', poster.variant === 'ten' ? 'Download (TEN)' : 'Download poster');
    dl.href = poster.url;
    dl.setAttribute('download', '');
    box.appendChild(dl);

    return box;
  }

  function openingCard(o) {
    var card = el('article', 'la-post');

    var top = el('div', 'la-post-top');
    top.appendChild(el('span', 'la-dom', o.name));
    if (o.role) top.appendChild(el('span', 'la-role', o.role));
    card.appendChild(top);

    var posters = o.posters || [];
    if (posters.length) {
      var plates = el('div', 'la-plates');
      posters.forEach(function (p) { plates.appendChild(plate(p, o.alt, o.name)); });
      card.appendChild(plates);
    }

    card.appendChild(textBlock(o.text));

    var acts = el('div', 'la-acts');
    var copy = el('button', 'la-btn', 'Copy text');
    var resetTimer = null;
    copy.setAttribute('type', 'button');
    copy.addEventListener('click', function () {
      copyText(String(o.text || '')).then(function () {
        copy.textContent = 'Copied';
        copy.className = 'la-btn la-btn-ok';
      }).catch(function () {
        copy.textContent = 'Press Ctrl+C';
      });
      /* Back to normal after a beat, so the button does not read "Copied"
         forever and leave somebody unsure whether their second click did
         anything. Clearing the previous timer first matters: without it, a
         second click three seconds in would be reset by the *first* click's
         timer a moment later, and the button would flick back to "Copy text"
         while the copy it just made was still the fresh one. */
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(function () {
        resetTimer = null;
        copy.textContent = 'Copy text';
        copy.className = 'la-btn';
      }, 2200);
    });
    acts.appendChild(copy);

    if (o.applyUrl) {
      var note = el('span', 'la-apply');
      note.appendChild(document.createTextNode('Apply link: '));
      var a = el('a', null, o.applyUrl);
      a.href = o.applyUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      note.appendChild(a);
      acts.appendChild(note);
    }

    card.appendChild(acts);
    return card;
  }

  function render(host, data) {
    host.textContent = '';
    var wrap = el('div', 'la');

    var head = el('div', 'la-head');
    head.appendChild(el('h3', 'la-title', 'Internship openings — post these on LinkedIn'));
    head.appendChild(el('p', 'la-sub', 'Copy the words, download the poster, and post it from your own account. Nothing here posts by itself.'));
    wrap.appendChild(head);

    var list = (data && data.openings) || [];
    if (!list.length) {
      wrap.appendChild(el('div', 'la-err', 'There are no openings to show right now.'));
      host.appendChild(wrap);
      return;
    }

    var feed = el('div', 'la-feed');
    list.forEach(function (o) { feed.appendChild(openingCard(o)); });
    wrap.appendChild(feed);
    host.appendChild(wrap);
  }

  function renderError(host, message) {
    host.textContent = '';
    var wrap = el('div', 'la');
    wrap.appendChild(el('h3', 'la-title', 'Internship openings'));
    wrap.appendChild(el('div', 'la-err', message));
    host.appendChild(wrap);
  }

  function mount(host, options) {
    if (!host) return;
    injectCss();
    var opts = options || {};
    host.textContent = '';
    var loading = el('div', 'la');
    loading.appendChild(el('h3', 'la-title', 'Internship openings'));
    loading.appendChild(el('p', 'la-sub', 'Loading the openings…'));
    host.appendChild(loading);

    var init = { credentials: 'same-origin', headers: {} };
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) {
        if (opts.headers[k]) init.headers[k] = opts.headers[k];
      });
    }

    fetch(API + '/openings', init)
      .then(function (r) {
        if (r.status === 401) throw new Error('Your session has expired. Sign in again to see the openings.');
        if (r.status === 403) throw new Error('This section is not available on your account.');
        if (!r.ok) throw new Error('The openings could not be loaded (' + r.status + ').');
        return r.json();
      })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error) || 'The openings could not be loaded.');
        render(host, data);
      })
      .catch(function (e) {
        renderError(host, e && e.message ? e.message : 'The openings could not be loaded.');
      });
  }

  window.TENLinkedInAgent = { mount: mount };
}());
