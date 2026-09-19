'use strict';

/**
 * The LinkedIn openings section, run for real.
 *
 * public/linkedin-agent.js is a browser IIFE with no build step and no
 * framework, so there is nothing to import: the file is read as text, parsed
 * by the vm module (a syntax error fails here, not in someone's browser), and
 * executed against a fake window whose document hands out plain objects that
 * remember their children, attributes and listeners. That is enough to mount
 * the section and read what it drew.
 *
 * What the section is now is a board of the fourteen internship openings —
 * poster, text, a copy button and a download link — shown in every portal to
 * everybody who signs in. The tests are about what it renders and what it
 * hands a person. Three matter more than the rest:
 *
 *   - **It must offer no way to publish.** No textarea, no send button, no
 *     form, no request to anything but the one read endpoint. The whole reason
 *     this section stopped being an agent is that nothing here may reach
 *     LinkedIn; a control that posted would put that back.
 *   - **Copy must copy the whole post, not the folded teaser.** A person who
 *     pastes a truncated post into LinkedIn has published half a hiring ad
 *     ending in an ellipsis, and will not notice until it is live.
 *   - **A domain with one poster and a domain with two must both render.** The
 *     TEN-building plates are not committed yet, so the one-poster case is
 *     today's reality and the two-poster case is next week's.
 *
 * The static checks are the ones a reviewer would otherwise repeat by eye: no
 * innerHTML (post text containing "<script>" must render as text), no inline
 * on*= handler strings, no secrets, every class name prefixed la- so the
 * injected stylesheet cannot restyle the portal around it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '../../public/linkedin-agent.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

/* ---------- a document made of plain objects ---------- */

function makeDom() {
  const all = [];
  function element(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [], attrs: {}, listeners: {}, style: {}, parentNode: null,
      _text: '', className: '', id: '', hidden: false, disabled: false, value: '', src: '',
      href: '', alt: '', loading: '', target: '', rel: '',
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
      /* Setting textContent detaches what was there, and the detached nodes
         have to actually lose their parent: `find`/`findAll` walk parentNode
         upwards, so a child left pointing at its old parent would still be
         found inside the host it was just cleared out of — and the test for
         "mounting twice re-renders rather than stacking" would pass whether
         the code re-rendered or not. */
      set textContent(v) {
        this._text = String(v);
        this.children.forEach((c) => { c.parentNode = null; });
        this.children = [];
      },
      get firstChild() { return this.children[0] || null; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; this[k] = ''; },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      dispatch(type, evt) { (this.listeners[type] || []).forEach((fn) => fn(Object.assign({ target: this, preventDefault() {} }, evt || {}))); },
      focus() {}, select() {},
      find(pred) { return all.find((n) => n !== this && contains(this, n) && pred(n)); },
      findAll(pred) { return all.filter((n) => n !== this && contains(this, n) && pred(n)); },
    };
    all.push(node);
    return node;
  }
  function contains(root, n) { for (let p = n.parentNode; p; p = p.parentNode) if (p === root) return true; return false; }
  const byId = {};
  const document = {
    head: element('head'),
    body: element('body'),
    createElement: element,
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [], parentNode: null }),
    getElementById: (id) => byId[id] || null,
    __register: (id, node) => { byId[id] = node; },
    execCommand: () => true,
  };
  return { document, all };
}

/* Long enough to fold: the module's threshold is 320 characters. */
const LONG_POST = [
  '🚀 WE ARE #HIRING #INTERNS | The Entrepreneurship Network (TEN)',
  '',
  'Applications are open for the October 2026 batch — Cyber Security Interns.',
  '',
  'No course to sit through first, no training block before you are allowed to touch anything real. From week one you are on an industry-level project, and the project is the training: you learn here by building and shipping, with a coordinator reviewing your work every week.',
  '',
  '🔗 Apply for Cyber Security: https://lnkd.in/gK5Cna3c',
].join('\n');

/* The answer routes/v2/linkedinAgent.js gives GET /openings. The first entry
   has one poster (today's reality) and the second has two (the day the
   TEN-building plates land), so both paths are exercised on every mount. */
function openingsBody() {
  return {
    ok: true,
    openings: [
      {
        slug: 'cyber',
        name: 'Cyber Security',
        role: 'Cyber Security Intern',
        tag: '#CyberSecurity',
        text: LONG_POST,
        applyUrl: 'https://lnkd.in/gK5Cna3c',
        alt: 'Hiring poster: TEN is hiring a Cyber Security Intern, October 2026 batch, Online, 3 Months, stipend Unpaid.',
        posters: [{ variant: 'domain', url: '/assets/linkedin-posters/cyber.jpg' }],
      },
      {
        slug: 'python',
        name: 'Python Development',
        role: 'Python Development Intern',
        tag: '#Python',
        text: 'a short one',
        applyUrl: 'https://lnkd.in/gK5Cna3c',
        alt: 'Hiring poster: TEN is hiring a Python Development Intern.',
        posters: [
          { variant: 'domain', url: '/assets/linkedin-posters/python.jpg' },
          { variant: 'ten', url: '/assets/linkedin-posters/python-ten.jpg' },
        ],
      },
    ],
  };
}

function makeServer(body) {
  const calls = [];
  const state = { body: body || openingsBody(), ok: true, status: 200 };
  const fetch = (url, init) => {
    calls.push({ url, init: init || {} });
    return Promise.resolve({
      ok: state.ok,
      status: state.status,
      json: () => Promise.resolve(typeof state.body === 'function' ? state.body() : state.body),
    });
  };
  return { calls, state, fetch };
}

function boot(opts) {
  const o = opts || {};
  const dom = makeDom();
  const server = makeServer(o.body);
  if (o.status) { server.state.status = o.status; server.state.ok = o.status < 400; }
  const copied = [];
  const context = {
    console, setTimeout, clearTimeout,
    document: dom.document,
    fetch: server.fetch,
    navigator: o.noClipboard ? {} : {
      clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
    },
    Promise,
  };
  context.window = context;
  vm.createContext(context);
  new vm.Script(SRC, { filename: 'linkedin-agent.js' }).runInContext(context);
  const host = dom.document.createElement('div');
  context.window.TENLinkedInAgent.mount(host, Object.assign(
    { headers: { Authorization: 'Bearer test-token' }, role: 'hr' }, o.options || {}));
  return { context, dom, server, host, copied };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms == null ? 5 : ms));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const hasClass = (n, c) => String(n.className || '').split(/\s+/).indexOf(c) >= 0;
const cards = (host) => host.findAll((n) => hasClass(n, 'la-post'));

async function mounted(opts) {
  const b = boot(opts);
  await settle();
  return b;
}

/* ---------- static ---------- */

describe('public/linkedin-agent.js (static)', () => {
  it('parses and defines window.TENLinkedInAgent.mount', () => {
    const context = {
      console, setTimeout, document: makeDom().document, navigator: {},
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    };
    context.window = context;
    vm.createContext(context);
    expect(() => new vm.Script(SRC, { filename: 'linkedin-agent.js' }).runInContext(context)).not.toThrow();
    expect(typeof context.window.TENLinkedInAgent.mount).toBe('function');
  });

  it('never assigns innerHTML and never wires a handler as a string', () => {
    expect(SRC).not.toMatch(/\.innerHTML\s*=/);
    expect(SRC).not.toMatch(/\bon(click|load|error|submit)\s*=\s*["']/);
    expect(SRC).not.toMatch(/\bdocument\.write\b/);
  });

  it('carries no credential and names no LinkedIn endpoint', () => {
    expect(SRC).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{12,}/);
    expect(SRC).not.toMatch(/api\.linkedin\.com/);
    expect(SRC).not.toMatch(/client_secret|LINKEDIN_ACCESS_TOKEN/i);
  });

  /* The stylesheet is injected into the portal's own <head>, so an unprefixed
     rule would restyle the dashboard around the section. */
  it('prefixes every class it styles with la-', () => {
    const selectors = SRC.match(/'\.[a-z][^{']*\{/g) || [];
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) expect(sel.startsWith("'.la")).toBe(true);
  });
});

/* ---------- mounting ---------- */

describe('the openings board', () => {
  it('asks the one read endpoint, and nothing else', async () => {
    const { server } = await mounted();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].url).toBe('/api/v2/linkedin/openings');
    expect(server.calls[0].init.credentials).toBe('same-origin');
  });

  it('passes through the Authorization header a portal supplies', async () => {
    const { server } = await mounted();
    expect(server.calls[0].init.headers.Authorization).toBe('Bearer test-token');
  });

  it('draws one card per opening', async () => {
    const { host } = await mounted();
    expect(cards(host)).toHaveLength(2);
    expect(host.textContent).toContain('Cyber Security');
    expect(host.textContent).toContain('Python Development');
  });

  it('mounting twice re-renders rather than stacking a second copy', async () => {
    const b = await mounted();
    b.context.window.TENLinkedInAgent.mount(b.host, { role: 'hr' });
    await settle();
    expect(cards(b.host)).toHaveLength(2);
  });

  it('shows an empty state rather than a blank panel when there is nothing', async () => {
    const { host } = await mounted({ body: { ok: true, openings: [] } });
    expect(host.textContent).toMatch(/no openings/i);
  });
});

/* ---------- posters ---------- */

describe('the posters', () => {
  it('renders every poster it is given, and a download link for each', async () => {
    const { host } = await mounted();
    const imgs = host.findAll((n) => n.tagName === 'IMG');
    expect(imgs.map((i) => i.src)).toEqual([
      '/assets/linkedin-posters/cyber.jpg',
      '/assets/linkedin-posters/python.jpg',
      '/assets/linkedin-posters/python-ten.jpg',
    ]);

    const links = host.findAll((n) => n.tagName === 'A' && n.getAttribute('download') !== null);
    expect(links).toHaveLength(3);
    expect(links.map((a) => a.href)).toEqual(imgs.map((i) => i.src));
  });

  it('handles one poster and two posters in the same render', async () => {
    const { host } = await mounted();
    const [cyber, python] = cards(host);
    expect(cyber.findAll((n) => n.tagName === 'IMG')).toHaveLength(1);
    expect(python.findAll((n) => n.tagName === 'IMG')).toHaveLength(2);
  });

  it('gives every poster the alt text the server supplied', async () => {
    const { host } = await mounted();
    for (const img of host.findAll((n) => n.tagName === 'IMG')) {
      expect(String(img.alt).length).toBeGreaterThan(10);
    }
  });

  it('renders an opening with no poster at all rather than dropping it', async () => {
    const body = openingsBody();
    body.openings[0].posters = [];
    const { host } = await mounted({ body });
    expect(cards(host)).toHaveLength(2);
    expect(host.textContent).toContain('Cyber Security');
    expect(host.findAll((n) => n.tagName === 'IMG')).toHaveLength(2);
  });
});

/* ---------- copying ---------- */

describe('copying the post', () => {
  it('copies the full post, not the folded teaser', async () => {
    const b = await mounted();
    const card = cards(b.host)[0];
    /* The card is folded — proof that the teaser is what is on screen. */
    expect(card.textContent).not.toContain('Apply for Cyber Security');

    const copy = card.find((n) => n.tagName === 'BUTTON' && hasClass(n, 'la-btn'));
    copy.dispatch('click');
    await settle();

    expect(b.copied).toHaveLength(1);
    expect(b.copied[0]).toBe(LONG_POST);
    expect(b.copied[0]).toContain('Apply for Cyber Security');
  });

  it('confirms the copy on the button', async () => {
    const b = await mounted();
    const copy = cards(b.host)[0].find((n) => n.tagName === 'BUTTON' && hasClass(n, 'la-btn'));
    copy.dispatch('click');
    await settle();
    expect(copy.textContent).toBe('Copied');
  });

  /* A coordinator reaching the box by IP is on an insecure origin, where
     navigator.clipboard is undefined. The button must still work. */
  it('falls back to a textarea when there is no clipboard API', async () => {
    const b = await mounted({ noClipboard: true });
    const copy = cards(b.host)[0].find((n) => n.tagName === 'BUTTON' && hasClass(n, 'la-btn'));
    expect(() => copy.dispatch('click')).not.toThrow();
    await settle();
    expect(copy.textContent).not.toBe('Press Ctrl+C');
  });

  it('offers the apply link as a real link', async () => {
    const { host } = await mounted();
    const apply = host.find((n) => n.tagName === 'A' && n.href === 'https://lnkd.in/gK5Cna3c');
    expect(apply).toBeTruthy();
    expect(apply.rel).toContain('noopener');
  });
});

/* ---------- folding ---------- */

describe('long posts', () => {
  it('folds a long post and opens it on demand', async () => {
    const { host } = await mounted();
    const card = cards(host)[0];
    const more = card.find((n) => n.tagName === 'BUTTON' && hasClass(n, 'la-more'));
    expect(more.textContent).toBe('Show more');
    expect(more.getAttribute('aria-expanded')).toBe('false');

    more.dispatch('click');
    expect(card.textContent).toContain('Apply for Cyber Security');
    expect(more.textContent).toBe('Show less');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves a short post unfolded, with no Show more at all', async () => {
    const { host } = await mounted();
    const card = cards(host)[1];
    expect(card.find((n) => hasClass(n, 'la-more'))).toBeUndefined();
    expect(card.textContent).toContain('a short one');
  });
});

/* ---------- what it must never be ---------- */

describe('it cannot publish', () => {
  it('renders no textarea, no form and no send control', async () => {
    const { host } = await mounted();
    expect(host.find((n) => n.tagName === 'TEXTAREA')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'FORM')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'INPUT')).toBeUndefined();
    const labels = host.findAll((n) => n.tagName === 'BUTTON').map((b) => b.textContent.toLowerCase());
    for (const label of labels) {
      expect(label).not.toMatch(/post|publish|send|schedule|connect/);
    }
  });

  it('makes exactly one request, and it is a GET with no body', async () => {
    const { server } = await mounted();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].init.method).toBeUndefined();
    expect(server.calls[0].init.body).toBeUndefined();
  });

  it('renders post text as text, so markup in a post cannot become markup', async () => {
    const body = openingsBody();
    body.openings[1].text = '<script>alert(1)</script> and <b>bold</b>';
    const { host } = await mounted({ body });
    expect(host.textContent).toContain('<script>alert(1)</script>');
    expect(host.find((n) => n.tagName === 'SCRIPT')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'B')).toBeUndefined();
  });
});

/* ---------- failure ---------- */

describe('when the server will not answer', () => {
  it('says the session expired on a 401', async () => {
    const { host } = await mounted({ status: 401 });
    expect(host.textContent).toMatch(/session has expired/i);
  });

  it('says the section is unavailable on a 403', async () => {
    const { host } = await mounted({ status: 403 });
    expect(host.textContent).toMatch(/not available on your account/i);
  });

  it('reports the status on any other failure, and draws no cards', async () => {
    const { host } = await mounted({ status: 500 });
    expect(host.textContent).toMatch(/could not be loaded \(500\)/);
    expect(cards(host)).toHaveLength(0);
  });
});
