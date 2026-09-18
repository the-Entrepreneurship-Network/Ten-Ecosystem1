/*
 * LinkedIn Agent panel, shared by the HR, coordinator, mentor and founder
 * dashboards. Everything comes from /api/v2/linkedin: staff type the post and
 * attach the photograph they want on it, the agent checks it and tidies the
 * lines, and it goes to The Entrepreneurship Network's company page when told
 * to.
 *
 * What gets published is the author's. The agent corrects mechanics —
 * shouting, a run of exclamation marks, a missing capital — and refuses
 * anything the company cannot publish, but it does not write the post and it
 * does not choose the picture.
 *
 *   TENLinkedInAgent.mount(el, { headers, role })
 *
 * The section is a plain IIFE like attendance-report.js: no build step, no
 * framework, styles injected once. Every string that reaches the page goes
 * through textContent or a text node, never innerHTML — the draft, the
 * agent's reply, the issue excerpts and the recent posts are all text the
 * server got from a human, and a `<script>` pasted into a draft must render
 * as the characters "<script>", not run.
 *
 * The one thing the browser does that the server cannot: rasterise the
 * poster. The server builds an SVG (fonts, brand colours, the embedded
 * logo), and LinkedIn wants a PNG. Node has no canvas here, so when the user
 * says "post" the page draws the SVG onto a <canvas> and sends the PNG bytes
 * along with the message. If that fails for any reason the message still
 * goes, without the image — a text post is better than a stuck one.
 */
(function () {
  "use strict";

  var API = "/api/v2/linkedin";
  var STYLE_ID = "ten-linkedin-agent-style";
  var STORE_KEY = "ten_linkedin_agent_session";
  var PAGE_NAME = "The Entrepreneurship Network";
  var PAGE_FOLLOWERS = "46K followers";
  /* LinkedIn folds a post after roughly this many characters and shows
     "…see more"; the preview folds at the same point so the hook is judged
     the way a follower will see it. */
  var FOLD_AT = 210;

  /*
   * Messages that end in a publish call on the server. These are the ones
   * that must carry the rasterised poster; anything else (a draft, "shorter",
   * "help") is text only. Scheduling is included because a scheduled post
   * publishes later without a browser around to draw the poster, so the PNG
   * has to travel now. The list mirrors the agent's own intent parser.
   */
  var PUBLISH_RE = /^(yes|post( it| this| now)?( anyway)?|publish( it| now)?( anyway)?|go ahead|ship it|confirm|post my original|post anyway|post it anyway|schedule .+)$/i;

  /*
   * Quick starts. Clicking one does not send anything: a two-word message
   * would be reviewed as a draft and bounced as too short. Instead the chip
   * tells the agent what kind of post is coming (session.kindHint, which the
   * agent honours over its own detection) and shows what to type.
   */
  var STARTERS = [
    { kind: "opening", label: "Internship opening",
      hint: "Tell me about the opening: the role, the domain, remote or on-site, the stipend, how long it runs, and the apply-by date. I will draft the post and the poster.",
      placeholder: "e.g. Hiring Python Development interns, remote, 2 months, ₹5,000 a month, apply by 30 Sept" },
    { kind: "placement", label: "Placement story",
      hint: "Who got placed, where, and as what? A line from them about the internship makes it land.",
      placeholder: "e.g. Priya Sharma has been placed at Infosys as a Software Engineer after her TEN internship" },
    { kind: "leadgen", label: "Attract freshers",
      hint: "What should students take away, and what do you want them to do next? Two or three points is plenty.",
      placeholder: "e.g. Invite final-year students to apply for virtual internships across 12 domains" },
  ];

  var CSS = [
    ".la{font-family:inherit;color:inherit;--la-gold:#f5c542;--la-gold2:#d4af37;--la-ink:#f0eee8;--la-muted:rgba(240,238,232,.62);--la-line:rgba(245,197,66,.14);--la-panel:rgba(255,255,255,.035);--la-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
    ".la *{box-sizing:border-box}",
    ".la-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 20px;margin-bottom:16px}",
    ".la-title{margin:0;font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1.1}",
    ".la-sub{margin:6px 0 0;font-size:13px;color:var(--la-muted)}",
    ".la-quick{display:flex;flex-wrap:wrap;gap:8px}",
    ".la-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px;align-items:start}",
    "@media(max-width:900px){.la-grid{grid-template-columns:minmax(0,1fr)}}",
    ".la-chat{display:flex;flex-direction:column;border:1px solid var(--la-line);border-radius:14px;background:var(--la-panel);min-height:520px;max-height:78vh;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 18px 40px -24px rgba(0,0,0,.7)}",
    ".la-thread{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;scroll-behavior:smooth}",
    ".la-thread::before{content:'';margin-top:auto}",
    ".la-msg{display:flex;flex-direction:column;gap:10px;max-width:94%}",
    ".la-agent{align-self:flex-start}.la-user{align-self:flex-end;align-items:flex-end}",
    ".la-who{font-family:var(--la-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--la-muted)}",
    ".la-bubble{padding:11px 14px;border-radius:14px;line-height:1.6;font-size:13.5px;white-space:pre-wrap;word-break:break-word}",
    ".la-agent .la-bubble{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-bottom-left-radius:4px}",
    ".la-user .la-bubble{background:rgba(245,197,66,.14);border:1px solid rgba(245,197,66,.32);border-bottom-right-radius:4px;color:var(--la-ink)}",
    ".la-err{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.4)}",
    ".la-typing{display:inline-flex;gap:5px;padding:14px 16px;align-self:flex-start;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:14px;border-bottom-left-radius:4px}",
    ".la-dot{width:6px;height:6px;border-radius:50%;background:var(--la-gold);opacity:.35;animation:la-blink 1.2s infinite}",
    ".la-dot:nth-child(2){animation-delay:.2s}.la-dot:nth-child(3){animation-delay:.4s}",
    "@keyframes la-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}",
    ".la-review{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 14px;background:rgba(10,6,0,.35);font-size:12.5px;line-height:1.55}",
    ".la-review-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
    ".la-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-family:var(--la-mono);font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}",
    ".la-pill-ok{color:#4ade80;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.4)}",
    ".la-pill-revise{color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.4)}",
    ".la-pill-block{color:#f87171;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.4)}",
    ".la-pill-muted{color:var(--la-muted);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14)}",
    ".la-issues{list-style:none;margin:10px 0 0;padding:0}",
    ".la-issue{display:grid;grid-template-columns:8px 1fr;gap:3px 10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.07)}",
    ".la-issue-dot{width:8px;height:8px;border-radius:50%;margin-top:5px}",
    ".la-issue-code{font-family:var(--la-mono);font-size:10.5px;letter-spacing:.06em;color:var(--la-muted)}",
    ".la-issue-msg{color:var(--la-ink)}",
    ".la-issue-fix{color:var(--la-muted)}.la-issue-fix b{color:var(--la-gold);font-weight:600}",
    ".la-issue-quote{color:var(--la-muted);font-style:italic}",
    ".la-sev-block{background:#f87171}.la-sev-revise{background:#fbbf24}.la-sev-note{background:rgba(255,255,255,.35)}",
    ".la-meta{font-family:var(--la-mono);font-size:11px;letter-spacing:.04em;color:var(--la-muted)}",
    ".la-li{background:#fff;color:rgba(0,0,0,.9);border-radius:8px;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 14px 34px -10px rgba(0,0,0,.6);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;width:100%;max-width:552px;overflow:hidden}",
    ".la-li-head{display:flex;gap:8px;padding:12px 16px 0;align-items:flex-start}",
    ".la-li-avatar{flex:none;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#f5c542,#d4af37);color:#0a0600;font-weight:800;display:grid;place-items:center;font-size:14px;letter-spacing:.02em;font-family:Outfit,Inter,-apple-system,sans-serif}",
    ".la-li-name{font-size:14px;font-weight:600;line-height:1.4;color:rgba(0,0,0,.9)}",
    ".la-li-sub{font-size:12px;line-height:1.33;color:rgba(0,0,0,.6)}",
    ".la-li-text{padding:8px 16px 10px;font-size:14px;line-height:1.43;white-space:pre-wrap;word-break:break-word}",
    ".la-li-more{background:none;border:0;padding:0;margin:0;font:inherit;color:rgba(0,0,0,.6);cursor:pointer}",
    ".la-li-more:hover{color:#0a66c2;text-decoration:underline}",
    ".la-tag{color:#0a66c2;font-weight:600}",
    ".la-li-img{display:block;width:100%;height:auto;background:#0a0600}",
    ".la-li-foot{display:flex;justify-content:space-around;padding:4px 8px;border-top:1px solid rgba(0,0,0,.08);color:rgba(0,0,0,.6);font-size:13px;font-weight:600}",
    ".la-li-foot span{padding:10px 6px}",
    ".la-options{display:flex;flex-wrap:wrap;gap:8px}",
    ".la-chip{padding:7px 13px;border-radius:99px;border:1px solid rgba(245,197,66,.35);background:rgba(245,197,66,.08);color:var(--la-gold);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;line-height:1.3;transition:transform .12s cubic-bezier(.2,.8,.2,1)}",
    ".la-chip:hover{background:rgba(245,197,66,.18)}.la-chip:active{transform:scale(.97)}",
    ".la-chip:disabled{opacity:.45;cursor:default}",
    ".la-chip small{opacity:.7;font-weight:500;margin-left:6px}",
    ".la-chip-primary{background:var(--la-gold);color:#0a0600;border-color:var(--la-gold)}.la-chip-primary:hover{background:#ffd75e}",
    ".la-chip-ghost{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:var(--la-ink);font-weight:500}.la-chip-ghost:hover{background:rgba(255,255,255,.09)}",
    ".la-input{display:flex;gap:10px;padding:12px;border-top:1px solid var(--la-line);align-items:flex-end}",
    ".la-ta{flex:1;min-height:46px;max-height:180px;resize:none;padding:12px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;font:inherit;font-size:13.5px;line-height:1.5}",
    ".la-ta::placeholder{color:var(--la-muted)}",
    ".la-send{height:46px;padding:0 18px;border-radius:12px;background:var(--la-gold);color:#0a0600;font:inherit;font-weight:700;border:0;cursor:pointer;transition:transform .12s cubic-bezier(.2,.8,.2,1)}",
    ".la-attach{height:46px;padding:0 14px;flex:0 0 auto;border-radius:12px;background:transparent;border:1px solid var(--la-line);color:var(--la-ink);font:inherit;font-size:12px;font-weight:600;cursor:pointer}",
    ".la-attach:hover{border-color:var(--la-gold);color:var(--la-gold)}",
    ".la-attach.la-on{border-color:var(--la-gold);color:var(--la-gold);background:rgba(245,197,66,.1)}",
    ".la-photo{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--la-line);font-size:12px;color:var(--la-muted)}",
    ".la-photo img{height:38px;width:38px;object-fit:cover;border-radius:8px;border:1px solid var(--la-line)}",
    ".la-photo button{margin-left:auto;background:transparent;border:0;color:var(--la-muted);cursor:pointer;font:inherit;text-decoration:underline}",
    ".la-photo button:hover{color:var(--la-ink)}",
    ".la-send:hover{background:#ffd75e}.la-send:active{transform:scale(.97)}.la-send:disabled{opacity:.5;cursor:default}",
    ".la-hint{padding:0 14px 10px;font-size:11px;color:var(--la-muted)}",
    ".la-side{display:flex;flex-direction:column;gap:14px;min-width:0}",
    ".la-card{border:1px solid var(--la-line);border-radius:14px;background:var(--la-panel);padding:14px 16px;font-size:13px;line-height:1.55}",
    ".la-card-t{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;font-family:var(--la-mono);font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--la-muted)}",
    ".la-conn{display:flex;gap:10px;align-items:flex-start}",
    ".la-conn-dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:6px;background:rgba(255,255,255,.3)}",
    ".la-conn-dot.la-on{background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,.15)}",
    ".la-conn-dot.la-warn{background:#fbbf24;box-shadow:0 0 0 4px rgba(251,191,36,.15)}",
    ".la-conn b{display:block;font-weight:600;color:var(--la-ink)}",
    ".la-conn p{margin:2px 0 0;color:var(--la-muted);font-size:12.5px}",
    ".la-facts{margin:10px 0 0;padding:0;list-style:none;font-size:12px;color:var(--la-muted);display:flex;flex-direction:column;gap:3px}",
    ".la-facts code{font-family:var(--la-mono);font-size:11px;color:var(--la-ink);opacity:.8}",
    ".la-card .la-chip{margin-top:12px}",
    ".la-posts{list-style:none;margin:0;padding:0}",
    ".la-post{display:flex;flex-direction:column;gap:4px;padding:10px 0;border-top:1px solid rgba(255,255,255,.07);font-size:12.5px}",
    ".la-post:first-child{border-top:0;padding-top:0}",
    ".la-post-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
    ".la-post-when{margin-left:auto;font-family:var(--la-mono);font-size:10.5px;color:var(--la-muted)}",
    ".la-post-text{color:var(--la-ink);opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
    ".la-badge{display:inline-block;padding:2px 8px;border-radius:99px;font-family:var(--la-mono);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid transparent}",
    ".la-badge-published{color:#4ade80;border-color:rgba(74,222,128,.4)}",
    ".la-badge-scheduled{color:#60a5fa;border-color:rgba(96,165,250,.4)}",
    ".la-badge-publishing{color:#fbbf24;border-color:rgba(251,191,36,.4)}",
    ".la-badge-failed,.la-badge-rejected{color:#f87171;border-color:rgba(248,113,113,.4)}",
    ".la-badge-draft,.la-badge-ready,.la-badge-dry{color:var(--la-muted);border-color:rgba(255,255,255,.18)}",
    ".la-kind{font-family:var(--la-mono);font-size:10.5px;color:var(--la-muted);letter-spacing:.06em}",
    ".la-link{color:var(--la-gold);text-decoration:underline;text-underline-offset:2px;font-weight:600}",
    ".la-link:hover{color:#ffd75e}",
    ".la-empty{color:var(--la-muted);font-size:12.5px}",
    ".la-payload{margin-top:8px}",
    ".la-payload summary{cursor:pointer;color:var(--la-gold);font-weight:600;font-size:12px}",
    ".la-payload pre{margin:8px 0 0;padding:10px;border-radius:8px;background:rgba(0,0,0,.35);font-family:var(--la-mono);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}",
    ".la button:focus-visible,.la textarea:focus-visible,.la a:focus-visible,.la summary:focus-visible{outline:2px solid var(--la-gold);outline-offset:2px}",
    "@media(prefers-reduced-motion:reduce){.la .la-dot{animation:none;opacity:.8}.la .la-chip,.la .la-send{transition:none}.la-thread{scroll-behavior:auto}}",
  ].join("\n");

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* Element builder, the same shape attendance-report.js uses: attribute
     keys starting with "on" become listeners, "text" becomes textContent. */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function text(s) { return document.createTextNode(String(s == null ? "" : s)); }

  /*
   * Hashtags and links in LinkedIn blue, the rest as plain text nodes. A
   * single capturing group in the split pattern means every odd index is a
   * match, so no second pass is needed to tell them apart.
   */
  function richText(container, str) {
    var parts = String(str || "").split(/(#[A-Za-z0-9_]+|https?:\/\/[^\s<>"']+)/);
    parts.forEach(function (p, i) {
      if (!p) return;
      container.appendChild(i % 2 ? h("span", { class: "la-tag", text: p }) : text(p));
    });
  }

  /* btoa only takes Latin-1; posters carry the rupee sign and en dashes, so
     the SVG is UTF-8 encoded byte by byte before it is base64'd. */
  function b64utf8(s) {
    var bytes = encodeURIComponent(String(s)).replace(/%([0-9A-F]{2})/g, function (m, p) { return String.fromCharCode(parseInt(p, 16)); });
    return btoa(bytes);
  }

  function svgSrc(svg) { return "data:image/svg+xml;base64," + b64utf8(svg); }

  /*
   * SVG -> <img> -> <canvas> -> PNG data URL -> the base64 part. Resolves null
   * on any failure or after eight seconds, never rejects: the caller sends the
   * message either way. The image and canvas are created fresh each time so a
   * poster that failed to decode once cannot poison the next attempt.
   */
  function rasterise(poster) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () { done(null); }, 8000);
      function done(v) { if (settled) return; settled = true; clearTimeout(timer); resolve(v); }
      try {
        if (!poster || !poster.svg || typeof Image !== "function") return done(null);
        var img = new Image();
        img.addEventListener("load", function () {
          try {
            var c = document.createElement("canvas");
            c.width = poster.width || 1200;
            c.height = poster.height || 1200;
            var ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, c.width, c.height);
            var url = String(c.toDataURL("image/png"));
            var b64 = url.split(",")[1] || "";
            done(b64 ? b64 : null);
          } catch (e) { done(null); }
        });
        img.addEventListener("error", function () { done(null); });
        img.src = svgSrc(poster.svg);
      } catch (e) { done(null); }
    });
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) { return {}; }
  }

  /* The session blob is the only thing kept in the browser, and only so a
     reload mid-draft does not lose the draft. Storage can be full, disabled,
     or a private window; none of that may break the panel. */
  function saveSession(session) {
    try {
      var raw = JSON.stringify(session || {});
      if (raw.length > 2000000) return;
      localStorage.setItem(STORE_KEY, raw);
    } catch (e) { /* not persisted; the conversation still works */ }
  }

  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function num(n) {
    n = Number(n) || 0;
    return n.toLocaleString("en-IN");
  }

  function badge(status, dryRun) {
    var s = String(status || "draft").toLowerCase();
    var label = s;
    if (dryRun && (s === "published" || s === "ready")) label = "dry run";
    return h("span", { class: "la-badge la-badge-" + (label === "dry run" ? "dry" : s), text: label });
  }

  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    var headers = opts.headers || {};
    var role = String(opts.role || "").toLowerCase();
    var canConnect = role === "hr" || role === "admin";
    css();
    clear(el);

    var state = { session: loadSession(), poster: null, busy: false };

    function request(path, init) {
      init = init || {};
      var req = { method: init.method || "GET", credentials: "same-origin", headers: Object.assign({}, headers) };
      if (init.body !== undefined) {
        req.headers["Content-Type"] = "application/json";
        req.body = JSON.stringify(init.body);
      }
      return fetch(API + path, req).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 || r.status === 403) throw new Error("Your login does not have access to the LinkedIn agent. Sign in as HR, a coordinator, a mentor or a founder.");
          if (!r.ok || j.ok === false || j.success === false) throw new Error(j.error || j.message || ("HTTP " + r.status));
          return j;
        });
      });
    }

    /* ---------- layout ---------- */

    var root = h("div", { class: "la" });
    el.appendChild(root);

    var quick = h("div", { class: "la-quick" });
    root.appendChild(h("div", { class: "la-head" }, [
      h("div", null, [
        h("h2", { class: "la-title", text: "LinkedIn Agent" }),
        h("p", { class: "la-sub", text: "Draft → review → poster → post to " + PAGE_NAME }),
      ]),
      quick,
    ]));

    var thread = h("div", { class: "la-thread", role: "log", "aria-live": "polite", "aria-label": "Conversation with the LinkedIn agent" });
    var ta = h("textarea", { class: "la-ta", rows: "1", "aria-label": "Message to the LinkedIn agent", placeholder: "Paste a draft or describe the post…" });
    var sendBtn = h("button", { type: "button", class: "la-send", "aria-label": "Send message", text: "Send" });

    /*
     * The author's own photograph, and the reason this control exists.
     *
     * What goes out is what the person wrote and the picture they chose. The
     * agent draws a poster only when it is asked to, so without this button
     * there would be no way to put an image on a post at all. The file is
     * read in the browser and travels as base64 with the publish message —
     * there is no upload endpoint and nothing is stored server-side until the
     * post itself is saved.
     */
    var fileInput = h("input", {
      type: "file", accept: "image/png,image/jpeg", style: "display:none", "aria-hidden": "true",
    });
    var attachBtn = h("button", {
      type: "button", class: "la-attach", "aria-label": "Attach a photo to this post",
      title: "Attach a photo", text: "Photo",
    });
    var photoRow = h("div", { class: "la-photo", style: "display:none" });
    var chat = h("div", { class: "la-chat" }, [
      thread,
      photoRow,
      h("div", { class: "la-input" }, [attachBtn, ta, sendBtn, fileInput]),
      h("div", { class: "la-hint", text: "Enter sends, Shift+Enter starts a new line." }),
    ]);

    var connCard = h("div", { class: "la-card" });
    var postsCard = h("div", { class: "la-card" });
    var side = h("div", { class: "la-side" }, [connCard, postsCard]);

    root.appendChild(h("div", { class: "la-grid" }, [chat, side]));

    /* ---------- thread pieces ---------- */

    function scrollDown() { thread.scrollTop = thread.scrollHeight; }

    function agentGroup() { return h("div", { class: "la-msg la-agent" }, [h("div", { class: "la-who", text: "TEN LinkedIn agent" })]); }

    function agentSay(str) {
      var g = agentGroup();
      g.appendChild(h("div", { class: "la-bubble", text: str }));
      thread.appendChild(g);
      scrollDown();
      return g;
    }

    function userSay(str) {
      thread.appendChild(h("div", { class: "la-msg la-user" }, [h("div", { class: "la-bubble", text: str })]));
      scrollDown();
    }

    function errorSay(err) {
      var g = agentGroup();
      g.appendChild(h("div", { class: "la-bubble la-err", text: "The agent did not answer: " + (err && err.message ? err.message : String(err)) + " Try again in a moment." }));
      thread.appendChild(g);
      scrollDown();
    }

    function typingRow() {
      return h("div", { class: "la-typing", "aria-label": "The agent is writing" }, [h("span", { class: "la-dot" }), h("span", { class: "la-dot" }), h("span", { class: "la-dot" })]);
    }

    function verdictPill(verdict) {
      var v = String(verdict || "ok").toLowerCase();
      var label = v === "ok" ? "Ready to post" : v === "revise" ? "Revised" : v === "block" ? "Will not post" : v;
      return h("span", { class: "la-pill la-pill-" + (v === "ok" || v === "revise" || v === "block" ? v : "muted"), text: label });
    }

    /* Verdict, then one row per issue: what was found, the excerpt it was
       found in, and what the agent did about it. */
    function reviewCard(review) {
      var card = h("div", { class: "la-review" });
      var top = h("div", { class: "la-review-top" }, [verdictPill(review.verdict)]);
      var issues = Array.isArray(review.issues) ? review.issues : [];
      top.appendChild(h("span", { class: "la-meta", text: issues.length ? issues.length + (issues.length === 1 ? " issue" : " issues") + (review.kind ? " · " + review.kind : "") : "no issues" + (review.kind ? " · " + review.kind : "") }));
      card.appendChild(top);
      if (issues.length) {
        var list = h("ul", { class: "la-issues" });
        issues.forEach(function (it) {
          it = it || {};
          var sev = String(it.severity || "note").toLowerCase();
          var body = h("div", null, [
            h("div", { class: "la-issue-code", text: String(it.code || "issue").replace(/_/g, " ") + " · " + sev }),
            h("div", { class: "la-issue-msg", text: it.message || "" }),
          ]);
          if (it.excerpt) body.appendChild(h("div", { class: "la-issue-quote", text: "“" + it.excerpt + "”" }));
          if (it.fix) body.appendChild(h("div", { class: "la-issue-fix" }, [h("b", { text: "Fix: " }), text(it.fix)]));
          list.appendChild(h("li", { class: "la-issue" }, [h("span", { class: "la-issue-dot la-sev-" + (sev === "block" || sev === "revise" ? sev : "note") }), body]));
        });
        card.appendChild(list);
      }
      return card;
    }

    /* The text as a follower sees it: folded at 210 characters with the same
       "…see more" LinkedIn shows, expanding in place. Cut at a word boundary
       so the fold never splits a hashtag in two. */
    function foldedText(str) {
      var box = h("div", { class: "la-li-text" });
      var expanded = str.length <= FOLD_AT;
      function draw() {
        clear(box);
        if (expanded) { richText(box, str); return; }
        var cut = str.slice(0, FOLD_AT).replace(/\s+\S*$/, "");
        richText(box, cut);
        box.appendChild(text(" "));
        box.appendChild(h("button", { type: "button", class: "la-li-more", "aria-expanded": "false", "aria-label": "See the full post", text: "…see more", onclick: function () { expanded = true; draw(); } }));
      }
      draw();
      return box;
    }

    function previewCard(post, poster, withImage) {
      var card = h("div", { class: "la-li", "aria-label": "Preview of the LinkedIn post" }, [
        h("div", { class: "la-li-head" }, [
          h("div", { class: "la-li-avatar", "aria-hidden": "true", text: "TEN" }),
          h("div", null, [
            h("div", { class: "la-li-name", text: PAGE_NAME }),
            h("div", { class: "la-li-sub", text: PAGE_FOLLOWERS }),
            h("div", { class: "la-li-sub", text: "1m" }),
          ]),
        ]),
        foldedText(String(post.text || "")),
      ]);
      /* The attached photograph is what a follower will see, so it is what
         the preview shows; a drawn poster only appears when there is no
         photograph to show instead. */
      if (state.photo && withImage) {
        var photo = h("img", { class: "la-li-img", alt: "Attached photo" });
        photo.src = state.photo.dataUrl;
        card.appendChild(photo);
      } else if (poster && poster.svg && withImage) {
        var img = h("img", { class: "la-li-img", alt: poster.alt || "Post image" });
        img.src = svgSrc(poster.svg);
        card.appendChild(img);
      }
      card.appendChild(h("div", { class: "la-li-foot" }, ["Like", "Comment", "Repost", "Send"].map(function (t) { return h("span", { text: t }); })));
      return card;
    }

    function metaLine(post, poster, withImage) {
      var tags = Array.isArray(post.hashtags) ? post.hashtags.length : (String(post.text || "").match(/#[A-Za-z0-9_]+/g) || []).length;
      var chars = post.chars != null ? post.chars : String(post.text || "").length;
      var bits = [num(chars) + " characters", tags + (tags === 1 ? " hashtag" : " hashtags")];
      if (poster && withImage) bits.push((poster.template || "square") + " poster attached");
      else if (poster) bits.push("no image");
      return h("div", { class: "la-meta", text: bits.join(" · ") });
    }

    /* Published, dry run, or failed — and for a dry run, the exact payload
       that would have gone out, so nobody has to guess what "dry run" hid. */
    function publishCard(pub) {
      var card = h("div", { class: "la-review" });
      var top = h("div", { class: "la-review-top" });
      if (pub.dryRun) {
        top.appendChild(h("span", { class: "la-pill la-pill-revise", text: "Dry run" }));
        top.appendChild(h("span", { class: "la-meta", text: "saved, not sent" }));
        card.appendChild(top);
        card.appendChild(h("p", { text: "LinkedIn is not connected on this server, so nothing was sent. This is exactly what would have gone out:" }));
        if (pub.payload) {
          card.appendChild(h("details", { class: "la-payload" }, [
            h("summary", { text: "Show payload" }),
            h("pre", { text: JSON.stringify(pub.payload, null, 2) }),
          ]));
        }
      } else if (pub.ok) {
        top.appendChild(h("span", { class: "la-pill la-pill-ok", text: "Published" }));
        card.appendChild(top);
        if (pub.url) card.appendChild(h("p", null, [h("a", { class: "la-link", href: pub.url, target: "_blank", rel: "noopener noreferrer", text: "Open the post on LinkedIn" })]));
      } else {
        top.appendChild(h("span", { class: "la-pill la-pill-block", text: "Not published" }));
        card.appendChild(top);
        card.appendChild(h("p", { text: pub.error || "LinkedIn did not accept the post." }));
      }
      return card;
    }

    function postsList(posts) {
      var list = h("ul", { class: "la-posts" });
      if (!posts || !posts.length) {
        list.appendChild(h("li", { class: "la-empty", text: "Nothing posted yet. The first one goes here." }));
        return list;
      }
      posts.forEach(function (p) {
        p = p || {};
        var url = p.url || (p.linkedin && p.linkedin.url) || "";
        var row = h("div", { class: "la-post-row" }, [badge(p.status, p.dryRun), h("span", { class: "la-kind", text: p.kind || "" })]);
        var stamp = when(p.publishedAt || p.scheduledFor || p.createdAt);
        if (stamp) row.appendChild(h("span", { class: "la-post-when", text: (p.status === "scheduled" ? "for " : "") + stamp }));
        var item = h("li", { class: "la-post" }, [row, h("div", { class: "la-post-text", text: String(p.final || p.text || "").slice(0, 160) })]);
        if (url) item.appendChild(h("a", { class: "la-link", href: url, target: "_blank", rel: "noopener noreferrer", text: "View on LinkedIn" }));
        list.appendChild(item);
      });
      return list;
    }

    /* Quick replies under an agent turn. Clicking one sends its value as the
       next message; the whole row goes quiet while the agent answers so a
       double click cannot post twice. */
    function optionRow(options) {
      var flat = [];
      if (options && Array.isArray(options.options)) flat = options.options;
      else if (options && Array.isArray(options.groups)) options.groups.forEach(function (g) { flat = flat.concat((g && g.options) || []); });
      var row = h("div", { class: "la-options", role: "group", "aria-label": "Quick replies" });
      flat.forEach(function (o) {
        if (!o) return;
        var label = typeof o === "string" ? o : (o.label || o.value || "");
        var value = typeof o === "string" ? o : (o.value || o.label || "");
        if (!label) return;
        var b = h("button", { type: "button", class: "la-chip" + (/^post( it)?( now)?$/i.test(String(value)) ? " la-chip-primary" : ""), onclick: function () { send(value); } }, [text(label)]);
        if (o && o.note) b.appendChild(h("small", { text: "· " + o.note }));
        row.appendChild(b);
      });
      return row;
    }

    function currentWithImage() {
      /* "No image" is the author's explicit instruction and outranks both. */
      if (state.session && state.session.withImage === false) return false;
      /*
       * An attached photograph is an image in its own right. This used to
       * require a poster, and since the agent stopped drawing one by default
       * that meant a person could attach a picture, watch it in the preview,
       * press Post and publish a text-only update.
       */
      if (state.photo) return true;
      if (!state.poster) return false;
      if (state.poster.withImage === false) return false;
      return true;
    }

    function renderReply(r) {
      var g = agentGroup();
      if (r.reply) g.appendChild(h("div", { class: "la-bubble", text: r.reply }));
      if (r.review) g.appendChild(reviewCard(r.review));
      if (r.post && r.post.text) {
        var withImage = currentWithImage();
        g.appendChild(previewCard(r.post, state.poster, withImage));
        g.appendChild(metaLine(r.post, state.poster, withImage));
      }
      if (r.publish) g.appendChild(publishCard(r.publish));
      if (Array.isArray(r.posts)) g.appendChild(postsList(r.posts));
      if (r.options) g.appendChild(optionRow(r.options));
      thread.appendChild(g);
      scrollDown();
    }

    function setBusy(on) {
      state.busy = on;
      sendBtn.disabled = on;
      ta.disabled = on;
    }

    /*
     * Forget the attached photograph and put the input row back as it was.
     *
     * Written defensively because it runs from the reply handler, on every
     * successful post. If anything about the row is not what it expects, the
     * important half — dropping the image so it cannot ride along with the
     * next post — must still happen, and the turn must not die on the way.
     */
    function clearPhoto() {
      state.photo = null;
      try {
        fileInput.value = "";
        if (attachBtn.classList) attachBtn.classList.remove("la-on");
        if (photoRow.style) photoRow.style.display = "none";
        while (photoRow.firstChild) photoRow.removeChild(photoRow.firstChild);
      } catch (e) { /* the attachment is already forgotten, which is the point */ }
    }

    /*
     * Show what is attached, so nobody publishes a picture they cannot see.
     *
     * The thumbnail is the file itself, read as a data URL; the same base64
     * is what travels to the server when the post goes out.
     */
    function showPhoto(file) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || "");
        var comma = dataUrl.indexOf(",");
        if (comma === -1) return;
        state.photo = { name: file.name, base64: dataUrl.slice(comma + 1), dataUrl: dataUrl };

        while (photoRow.firstChild) photoRow.removeChild(photoRow.firstChild);
        var img = h("img", { alt: "" });
        img.src = dataUrl;
        var label = h("span", { text: file.name + " will be attached to this post" });
        var remove = h("button", { type: "button", text: "Remove" });
        remove.addEventListener("click", clearPhoto);
        photoRow.appendChild(img);
        photoRow.appendChild(label);
        photoRow.appendChild(remove);
        photoRow.style.display = "flex";
        attachBtn.classList.add("la-on");
      };
      reader.readAsDataURL(file);
    }

    attachBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      /* LinkedIn takes far larger images than this, but the base64 rides in a
         JSON body the route caps at 6 MB, and a rejected post explains itself
         badly. Better to say so here, before anything is typed. */
      if (file.size > 4 * 1024 * 1024) {
        agentSay("That image is larger than 4 MB. Please attach a smaller one.");
        fileInput.value = "";
        return;
      }
      showPhoto(file);
    });

    function send(message) {
      message = String(message || "").trim();
      if (!message || state.busy) return;
      setBusy(true);
      userSay(message);
      ta.value = "";
      ta.style.height = "";
      var typing = typingRow();
      thread.appendChild(typing);
      scrollDown();

      /*
       * The attached photograph wins over a drawn poster.
       *
       * A person who picked a picture picked it deliberately; a poster only
       * exists because they asked the agent to draw one. So the attachment is
       * used when there is one, and the rasterised poster is the fallback.
       */
      var needsPng = PUBLISH_RE.test(message) && currentWithImage();
      var png = !needsPng ? Promise.resolve(null)
        : state.photo ? Promise.resolve(state.photo.base64)
          : rasterise(state.poster);

      png.then(function (pngBase64) {
        var body = { message: message, session: state.session || {} };
        if (pngBase64) body.pngBase64 = pngBase64;
        return request("/chat", { method: "POST", body: body });
      }).then(function (r) {
        typing.remove();
        if (r.session && typeof r.session === "object") state.session = r.session;
        if (r.poster && r.poster.svg) state.poster = r.poster;
        else if (r.session && r.session.poster && r.session.poster.svg) state.poster = r.session.poster;
        /* Once a post is out (or booked), the poster is spent; and a cleared
           session means "start over", so a stale poster must not ride along
           with the next draft's "post now". */
        if (r.kind === "posted" || r.kind === "scheduled" || (r.session && !r.session.final && !r.session.draft)) {
          state.poster = null;
          /* The photograph belongs to the post that has just gone out. Leaving
             it attached would put it silently on the next one. */
          clearPhoto();
        }
        saveSession(state.session);
        renderReply(r);
        if (r.kind === "posted" || r.kind === "scheduled") loadPosts();
      }).catch(function (e) {
        typing.remove();
        errorSay(e);
      }).then(function () {
        setBusy(false);
        scrollDown();
        ta.focus();
      });
    }

    function submit() { send(ta.value); }

    sendBtn.addEventListener("click", submit);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    ta.addEventListener("input", function () {
      ta.style.height = "";
      var next = Math.min(180, ta.scrollHeight || 0);
      if (next) ta.style.height = next + "px";
    });

    /* ---------- quick starts ---------- */

    STARTERS.forEach(function (s) {
      quick.appendChild(h("button", { type: "button", class: "la-chip", text: s.label, onclick: function () {
        if (!state.session || typeof state.session !== "object") state.session = {};
        state.session.kindHint = s.kind;
        saveSession(state.session);
        agentSay(s.hint);
        ta.placeholder = s.placeholder;
        ta.focus();
      } }));
    });
    quick.appendChild(h("button", { type: "button", class: "la-chip la-chip-ghost", text: "Help", onclick: function () { send("help"); } }));
    quick.appendChild(h("button", { type: "button", class: "la-chip la-chip-ghost", text: "New post", onclick: function () { send("new post"); } }));

    /* ---------- side rail ---------- */

    function connectButton(configured) {
      return h("button", { type: "button", class: "la-chip la-chip-primary", text: configured ? "Reconnect LinkedIn" : "Connect LinkedIn", "aria-label": (configured ? "Reconnect" : "Connect") + " the LinkedIn company page", onclick: function () {
        window.location.href = API + "/oauth/start";
      } });
    }

    /* Three states, decided from /status: connected, expiring (or expired),
       and not connected. "Not connected" is not an error — every post is
       still reviewed, previewed and saved as a dry run — so it is explained,
       not shouted. */
    function renderConnection(status) {
      clear(connCard);
      connCard.appendChild(h("h3", { class: "la-card-t", text: "Connection" }));
      var li = (status && status.linkedin) || {};
      var configured = Boolean(li.configured);
      var days = typeof li.expiresInDays === "number" ? li.expiresInDays : null;
      var expired = configured && days !== null && days <= 0;
      var expiring = configured && !expired && ((days !== null && days < 7) || Boolean(li.warning));
      var dot = h("span", { class: "la-conn-dot" + (configured && !expired ? (expiring ? " la-warn" : " la-on") : expired ? " la-warn" : "") });
      var body = h("div");
      if (expired) {
        body.appendChild(h("b", { text: "Connection expired" }));
        body.appendChild(h("p", { text: li.warning || "LinkedIn access has lapsed, so posts fall back to dry run until the page is reconnected." }));
      } else if (expiring) {
        body.appendChild(h("b", { text: "Connected — expiring soon" }));
        body.appendChild(h("p", { text: li.warning || ("Access to " + (li.orgName || PAGE_NAME) + " expires in " + days + (days === 1 ? " day" : " days") + ". Reconnect before it lapses so scheduled posts still go out.") }));
      } else if (configured) {
        body.appendChild(h("b", { text: "Connected to " + (li.orgName || PAGE_NAME) }));
        body.appendChild(h("p", { text: days !== null ? "Posts go live on the company page. Access expires in " + days + (days === 1 ? " day" : " days") + "." : "Posts go live on the company page." }));
      } else {
        body.appendChild(h("b", { text: "Not connected — dry run" }));
        body.appendChild(h("p", { text: "Posts are reviewed, previewed and saved here, but nothing is sent to LinkedIn. An HR or admin login can connect the company page." }));
      }
      var facts = h("ul", { class: "la-facts" });
      var llm = status && status.llm;
      facts.appendChild(h("li", null, ["Writer: ", h("code", { text: llm === "openai" ? "OpenAI" : llm === "gemini" ? "Gemini" : "built-in composer" })]));
      if (li.orgUrn) facts.appendChild(h("li", null, ["Page: ", h("code", { text: String(li.orgUrn) })]));
      if (status && status.scheduler) facts.appendChild(h("li", null, ["Scheduler: ", h("code", { text: status.scheduler.enabled ? "on" : "off" })]));
      body.appendChild(facts);
      connCard.appendChild(h("div", { class: "la-conn" }, [dot, body]));
      if (canConnect) connCard.appendChild(connectButton(configured));
    }

    function renderConnectionError(err) {
      clear(connCard);
      connCard.appendChild(h("h3", { class: "la-card-t", text: "Connection" }));
      connCard.appendChild(h("div", { class: "la-conn" }, [h("span", { class: "la-conn-dot" }), h("div", null, [
        h("b", { text: "Status unavailable" }),
        h("p", { text: err && err.message ? err.message : String(err) }),
      ])]));
    }

    function loadStatus() {
      request("/status").then(renderConnection).catch(renderConnectionError);
    }

    function renderPosts(posts) {
      clear(postsCard);
      postsCard.appendChild(h("h3", { class: "la-card-t" }, [
        text("Recent posts"),
        h("button", { type: "button", class: "la-chip la-chip-ghost", text: "Refresh", "aria-label": "Refresh recent posts", onclick: loadPosts }),
      ]));
      postsCard.appendChild(postsList(posts));
    }

    function loadPosts() {
      request("/posts?limit=8").then(function (j) { renderPosts(j.posts || []); }).catch(function (e) {
        clear(postsCard);
        postsCard.appendChild(h("h3", { class: "la-card-t", text: "Recent posts" }));
        postsCard.appendChild(h("div", { class: "la-empty", text: "Could not load posts: " + (e && e.message ? e.message : String(e)) }));
      });
    }

    /* ---------- go ---------- */

    agentSay("Paste a draft or describe what to announce — an internship opening, a placement, or a call to students. I review it, rewrite it LinkedIn-ready, build the poster, and post it to " + PAGE_NAME + " when you say so.");
    if (state.session && state.session.final) {
      agentSay("You have a draft from last time. Type “post now” to publish it, “regenerate” for a new version, or “new post” to start over.");
    }
    loadStatus();
    loadPosts();
  }

  window.TENLinkedInAgent = { mount: mount };
})();
