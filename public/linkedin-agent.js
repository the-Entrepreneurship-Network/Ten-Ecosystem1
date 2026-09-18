/*
 * The LinkedIn Agent section, as it appears in the HR, coordinator, mentor and
 * founder dashboards.
 *
 * It is a window, not a console. There is no text box, no send button, no
 * poster picker and no publish action, because there is nothing here for a
 * person to do: the agent writes one hiring post every Saturday and every
 * Sunday, rotating through the fourteen domains, and puts it on the company
 * page by itself. What this section answers is the question somebody actually
 * has when they open it — how many posts has it done, what went out last, and
 * what is going out next.
 *
 * Three things it is careful about.
 *
 * `mount()` is called again every time the tab is opened, in four dashboards
 * that each re-run their own mount logic on every switch. So it is idempotent:
 * the same host element mounted twice re-renders rather than stacking a second
 * copy of the section underneath the first.
 *
 * A server with no LinkedIn token still records every weekend post — it builds
 * the payload and saves it and simply never sends it. That is a legitimate
 * configuration and it is how a fresh deployment behaves, but it means the
 * count on this card can be a count of posts nobody saw. So when the page is
 * not connected the card says so, at the top, in the place the eye lands
 * first, rather than in a footnote.
 *
 * Nothing from the server is interpolated as HTML. Post excerpts are text the
 * agent generated, and the domain names come from a constant, but they arrive
 * over the network like anything else and are written with textContent.
 */
(function () {
  'use strict';

  var API = '/api/v2/linkedin';
  var CSS_ID = 'ten-linkedin-agent-css';

  var CSS = [
    '.la{color:#e8eaf0;font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.la *{box-sizing:border-box}',
    '.la-head{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;justify-content:space-between;margin-bottom:16px}',
    '.la-title{font-size:19px;font-weight:700;letter-spacing:-.01em;margin:0 0 4px}',
    '.la-sub{margin:0;font-size:13px;color:#98a2b8}',
    '.la-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}',
    '.la-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 16px}',
    '.la-n{font-size:30px;font-weight:800;line-height:1.1;letter-spacing:-.02em}',
    '.la-k{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:#98a2b8;margin-top:4px}',
    '.la-gold{color:#e3b23c}',
    '.la-note{display:flex;gap:10px;align-items:flex-start;border-radius:12px;padding:11px 14px;font-size:13px;margin-bottom:16px;border:1px solid}',
    '.la-note-warn{background:rgba(227,178,60,.09);border-color:rgba(227,178,60,.35);color:#f0d492}',
    '.la-note-ok{background:rgba(52,199,123,.08);border-color:rgba(52,199,123,.28);color:#9fe3c0}',
    '.la-sec{margin-top:20px}',
    '.la-sec h4{margin:0 0 9px;font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:#98a2b8;font-weight:700}',
    '.la-row{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:11px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.025);margin-bottom:7px}',
    '.la-thumb{width:34px;height:42px;flex:0 0 34px;border-radius:5px;object-fit:cover;background:rgba(255,255,255,.06)}',
    '.la-row-main{min-width:0;flex:1}',
    '.la-row-top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
    '.la-dom{font-weight:650}',
    '.la-when{font-size:12px;color:#98a2b8}',
    '.la-ex{font-size:12.5px;color:#aeb6c6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}',
    '.la-pill{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid;white-space:nowrap}',
    '.la-p-live{color:#9fe3c0;border-color:rgba(52,199,123,.4);background:rgba(52,199,123,.12)}',
    '.la-p-dry{color:#f0d492;border-color:rgba(227,178,60,.4);background:rgba(227,178,60,.11)}',
    '.la-p-fail{color:#ffb3ae;border-color:rgba(255,107,98,.4);background:rgba(255,107,98,.11)}',
    '.la-p-next{color:#a9c7ff;border-color:rgba(124,160,255,.38);background:rgba(124,160,255,.1)}',
    '.la-link{color:#7ca0ff;text-decoration:none;font-size:12px;font-weight:600;white-space:nowrap}',
    '.la-link:hover{text-decoration:underline}',
    '.la-empty{color:#98a2b8;font-size:13px;padding:12px;border:1px dashed rgba(255,255,255,.13);border-radius:11px}',
    '.la-err{color:#ffb3ae;font-size:13px;padding:12px;border:1px solid rgba(255,107,98,.35);background:rgba(255,107,98,.08);border-radius:11px}',
    '.la-foot{margin-top:18px;font-size:12px;color:#7d8699;line-height:1.6}',
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

  /* A poster lives at a predictable path, and a domain the folder has no file
     for simply shows the empty plate rather than a broken-image icon. */
  var SLUGS = {
    'Python Development': 'python', 'Web Development': 'web', 'Business Development': 'business',
    'MERN Stack Development': 'mern', 'HR': 'hr', 'Data Science': 'datasci',
    'Java Development': 'java', 'Space': 'space', 'Cyber Security': 'cyber',
    'Venture Capital': 'venture', 'Flutter Development': 'flutter',
    'Software Engineering': 'softeng', 'DevOps with AWS': 'devops', 'Vibe Coding': 'vibe',
  };

  function thumb(domain) {
    var img = el('img', 'la-thumb');
    img.alt = '';
    img.loading = 'lazy';
    var slug = SLUGS[domain];
    if (slug) img.src = '/assets/linkedin-posters/' + slug + '.jpg';
    img.onerror = function () { img.removeAttribute('src'); };
    return img;
  }

  /* Dates come back as ISO strings and are shown in IST, because the schedule
     is stated in IST and a coordinator in Bhubaneswar reading "14:30" for a
     10:00 post would reasonably conclude something had gone wrong. */
  function istText(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: true,
      }) + ' IST';
    } catch (e) {
      return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
  }

  function dayText(ymd) {
    var d = new Date(String(ymd) + 'T00:00:00+05:30');
    if (isNaN(d.getTime())) return String(ymd || '');
    try {
      return d.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
      });
    } catch (e) {
      return String(ymd);
    }
  }

  function card(n, label, gold) {
    var c = el('div', 'la-card');
    c.appendChild(el('div', 'la-n' + (gold ? ' la-gold' : ''), n));
    c.appendChild(el('div', 'la-k', label));
    return c;
  }

  function pill(text, kind) {
    return el('span', 'la-pill la-p-' + kind, text);
  }

  function postRow(p) {
    var row = el('div', 'la-row');
    row.appendChild(thumb(p.domain));

    var main = el('div', 'la-row-main');
    var top = el('div', 'la-row-top');
    top.appendChild(el('span', 'la-dom', p.domain || 'LinkedIn post'));
    if (p.status === 'failed') top.appendChild(pill('did not send', 'fail'));
    else if (p.dryRun) top.appendChild(pill('dry run', 'dry'));
    else top.appendChild(pill('published', 'live'));
    var when = istText(p.at);
    if (when) top.appendChild(el('span', 'la-when', when));
    main.appendChild(top);

    var detail = p.status === 'failed' && p.error ? p.error : p.excerpt;
    if (detail) main.appendChild(el('div', 'la-ex', detail));
    row.appendChild(main);

    if (p.url) {
      var a = el('a', 'la-link', 'View on LinkedIn');
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      row.appendChild(a);
    }
    return row;
  }

  function upcomingRow(item, pending) {
    var row = el('div', 'la-row');
    row.appendChild(thumb(item.domain));
    var main = el('div', 'la-row-main');
    var top = el('div', 'la-row-top');
    top.appendChild(el('span', 'la-dom', item.domain || '—'));
    top.appendChild(pill(pending ? 'queued' : 'scheduled', 'next'));
    main.appendChild(top);
    main.appendChild(el('div', 'la-ex', item.role || ''));
    row.appendChild(main);
    row.appendChild(el('span', 'la-when', item.when || ''));
    return row;
  }

  function section(title, rows, emptyText) {
    var s = el('div', 'la-sec');
    s.appendChild(el('h4', null, title));
    if (!rows.length) {
      s.appendChild(el('div', 'la-empty', emptyText));
      return s;
    }
    rows.forEach(function (r) { s.appendChild(r); });
    return s;
  }

  function render(host, data) {
    var stats = (data && data.stats) || {};
    var schedule = stats.schedule || { hour: 10, days: ['Saturday', 'Sunday'] };
    host.textContent = '';

    var wrap = el('div', 'la');

    var head = el('div', 'la-head');
    var titles = el('div');
    titles.appendChild(el('h3', 'la-title', 'LinkedIn Agent'));
    titles.appendChild(el('p', 'la-sub',
      'Posts one internship opening to the company page every ' +
      (schedule.days || []).join(' and ') + ', at ' +
      String(schedule.hour).padStart(2, '0') + ':00 IST. Nobody has to write it.'));
    head.appendChild(titles);
    wrap.appendChild(head);

    if (data && data.dryRun) {
      var warn = el('div', 'la-note la-note-warn');
      warn.appendChild(el('span', null,
        'The company page is not connected on this server, so the agent is writing and '
        + 'saving these posts but not sending them. The count below is what it would have '
        + 'published. Ask HR to connect the page to make them live.'));
      wrap.appendChild(warn);
    }

    var cards = el('div', 'la-cards');
    cards.appendChild(card(stats.published || 0, 'posts published', true));
    cards.appendChild(card(stats.scheduled || 0, 'waiting to go out'));
    cards.appendChild(card(stats.failed || 0, 'failed'));
    cards.appendChild(card(stats.total || 0, 'posts on record'));
    wrap.appendChild(cards);

    var recent = (stats.recent || []).map(postRow);
    wrap.appendChild(section('Recently posted', recent,
      'Nothing has gone out yet. The first post lands on the next Saturday or Sunday.'));

    var queued = (stats.upcoming || []).map(function (u) {
      return upcomingRow({ domain: u.domain, role: '', when: istText(u.scheduledFor) }, true);
    });
    var forecast = (data && data.forecast ? data.forecast : []).map(function (f) {
      return upcomingRow({ domain: f.domain, role: f.role, when: dayText(f.date) }, false);
    });
    wrap.appendChild(section('Coming up', queued.concat(forecast),
      'The next weekend slot will be filled automatically.'));

    wrap.appendChild(el('div', 'la-foot',
      'Each post carries that domain’s poster and only that domain’s application link. '
      + 'The rotation walks all fourteen domains, so a domain comes round roughly every seven weeks. '
      + 'The stipend is stated as unpaid on every post.'));

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
    loading.appendChild(el('p', 'la-sub', 'Loading the posting history…'));
    host.appendChild(loading);

    var init = { credentials: 'same-origin', headers: {} };
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) {
        if (opts.headers[k]) init.headers[k] = opts.headers[k];
      });
    }

    fetch(API + '/autopilot', init)
      .then(function (r) {
        if (r.status === 401) throw new Error('Your session has expired. Sign in again to see the posting history.');
        if (r.status === 403) throw new Error('This section is for HR, coordinators, mentors and founders.');
        if (!r.ok) throw new Error('The server could not load the posting history (' + r.status + ').');
        return r.json();
      })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error) || 'The server could not load the posting history.');
        render(host, data);
      })
      .catch(function (e) {
        renderError(host, e && e.message ? e.message : 'The posting history could not be loaded.');
      });
  }

  window.TENLinkedInAgent = { mount: mount };
}());
