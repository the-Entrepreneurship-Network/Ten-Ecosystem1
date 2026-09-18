'use strict';

/**
 * The LinkedIn Agent section, run for real.
 *
 * public/linkedin-agent.js is a browser IIFE with no build step and no
 * framework, so there is nothing to import: the file is read as text, parsed
 * by the vm module (a syntax error fails here, not in someone's browser), and
 * executed against a fake window whose document hands out plain objects that
 * remember their children, attributes and listeners. That is enough to mount
 * the section and read what it drew.
 *
 * What the section is now is a window onto an unattended job, so the tests are
 * about what it reports rather than what it sends. Two of them matter more
 * than the rest:
 *
 *   - it must offer no way to write a post. No textarea, no send button, no
 *     form. The agent posts by itself; a text box here would be a second,
 *     unrotated route to the company page.
 *   - when the server says the page is not connected, the count it shows is a
 *     count of posts nobody saw, and it has to say so where the eye lands
 *     rather than in a footnote.
 *
 * The static checks are the ones a reviewer would otherwise repeat by eye: no
 * innerHTML (a post excerpt containing "<script>" must render as text), no
 * inline on*= handler strings, no secrets, and every class name prefixed la-
 * so the injected stylesheet cannot restyle the dashboard around it.
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
      focus() {},
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
  };
  return { document, all };
}

/* The answer routes/v2/linkedinAgent.js gives GET /autopilot, with two posts
   behind it and a rotation in front. Tests reshape `body` before mounting. */
function autopilotBody() {
  return {
    ok: true,
    role: 'hr',
    connected: true,
    dryRun: false,
    stats: {
      published: 9,
      failed: 1,
      scheduled: 1,
      total: 11,
      schedule: { hour: 10, days: ['Saturday', 'Sunday'], timezone: 'Asia/Kolkata' },
      upcoming: [
        { domain: 'Data Science', scheduledFor: '2026-09-19T04:30:00.000Z', status: 'scheduled', source: 'autopilot' },
      ],
      recent: [
        {
          id: 'a1', domain: 'Python Development', status: 'published', source: 'autopilot',
          dryRun: false, withImage: true, at: '2026-09-13T04:30:00.000Z',
          url: 'https://www.linkedin.com/feed/update/urn:li:share:7/', error: '',
          excerpt: 'WE ARE #HIRING #INTERNS | The Entrepreneurship Network (TEN)',
        },
        {
          id: 'a2', domain: 'HR', status: 'failed', source: 'autopilot',
          dryRun: false, withImage: true, at: '2026-09-12T04:30:00.000Z',
          url: '', error: 'LinkedIn refused the post', excerpt: 'WE ARE #HIRING',
        },
      ],
    },
    forecast: [
      { date: '2026-09-19', domain: 'Data Science', role: 'Data Science Intern' },
      { date: '2026-09-20', domain: 'Java Development', role: 'Java Development Intern' },
    ],
  };
}

function makeServer(body) {
  const calls = [];
  const state = { body: body || autopilotBody(), ok: true, status: 200 };
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
  const context = {
    console, setTimeout, clearTimeout,
    document: dom.document,
    fetch: server.fetch,
  };
  context.window = context;
  vm.createContext(context);
  new vm.Script(SRC, { filename: 'linkedin-agent.js' }).runInContext(context);
  const host = dom.document.createElement('div');
  context.window.TENLinkedInAgent.mount(host, Object.assign(
    { headers: { Authorization: 'Bearer test-token' }, role: 'hr' }, o.options || {}));
  return { context, dom, server, host };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms == null ? 5 : ms));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const hasClass = (n, c) => String(n.className || '').split(/\s+/).indexOf(c) >= 0;
const textOf = (host) => host.textContent;

async function mounted(opts) {
  const b = boot(opts);
  await settle();
  return b;
}

/* ---------- static ---------- */

describe('public/linkedin-agent.js (static)', () => {
  it('parses and defines window.TENLinkedInAgent.mount', () => {
    const context = { console, setTimeout, document: makeDom().document, fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }) };
    context.window = context;
    vm.createContext(context);
    expect(() => new vm.Script(SRC, { filename: 'linkedin-agent.js' }).runInContext(context)).not.toThrow();
    expect(typeof context.window.TENLinkedInAgent.mount).toBe('function');
  });

  it('never assigns innerHTML and never wires a handler as a string', () => {
    expect(SRC).not.toMatch(/\.innerHTML\s*=/);
    expect(SRC).not.toMatch(/\.outerHTML\s*=/);
    expect(SRC).not.toMatch(/insertAdjacentHTML/);
    expect(SRC).not.toMatch(/\son[a-z]+\s*=\s*["'][^"']*\(/);
    expect(SRC).not.toMatch(/\beval\s*\(/);
  });

  it('carries no secrets, only the auth header the dashboard hands it', () => {
    expect(SRC).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{12,}/);
    expect(SRC).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(SRC).not.toMatch(/client_secret/i);
  });

  it('talks only to /api/v2/linkedin', () => {
    const urls = SRC.match(/['"`](https?:)?\/\/?[^'"`\s]+['"`]/g) || [];
    urls
      .map((u) => u.slice(1, -1))
      .filter((u) => u.indexOf('/api/') === 0 || /^https?:/.test(u))
      .forEach((u) => { expect(u.indexOf('/api/v2/linkedin')).toBe(0); });
  });

  it('prefixes every class it styles with la- so the stylesheet cannot leak', () => {
    const from = SRC.indexOf('var CSS = [');
    const css = SRC.slice(from, SRC.indexOf('].join(', from));
    const selectors = css.match(/\.[a-zA-Z][\w-]*/g) || [];
    expect(selectors.length).toBeGreaterThan(10);
    selectors.forEach((s) => { expect(s.indexOf('.la')).toBe(0); });
  });

  /*
   * The manual composer is gone from the server; it has to be gone from the
   * browser too, or the section would be a text box wired to a 404 — which
   * reads, to whoever is looking at it, as the feature being broken rather
   * than as the feature having changed.
   */
  it('has no composing surface left in the source at all', () => {
    expect(SRC).not.toMatch(/createElement\(\s*['"]textarea['"]/i);
    expect(SRC).not.toMatch(/\/chat\b/);
    expect(SRC).not.toMatch(/pngBase64/);
    expect(SRC).not.toMatch(/method:\s*['"]POST['"]/);
    expect(SRC).not.toMatch(/method:\s*['"]DELETE['"]/);
  });
});

/* ---------- mounting ---------- */

describe('mounting', () => {
  it('asks the autopilot endpoint once, with the dashboard headers', async () => {
    const { server } = await mounted();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].url).toBe('/api/v2/linkedin/autopilot');
    expect(server.calls[0].init.headers.Authorization).toBe('Bearer test-token');
    expect(server.calls[0].init.credentials).toBe('same-origin');
  });

  it('sends no Authorization header when the dashboard has none to give', async () => {
    const { server } = await mounted({ options: { headers: undefined, role: 'coordinator' } });
    expect(server.calls[0].init.headers.Authorization).toBeUndefined();
  });

  it('shows the count of published posts and the posting schedule', async () => {
    const { host } = await mounted();
    const text = textOf(host);
    expect(text).toContain('9');
    expect(text).toMatch(/posts published/i);
    expect(text).toMatch(/Saturday and Sunday/);
    expect(text).toMatch(/10:00 IST/);
  });

  it('offers nothing to type into and nothing to press', async () => {
    const { host } = await mounted();
    expect(host.find((n) => n.tagName === 'TEXTAREA')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'INPUT')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'BUTTON')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'FORM')).toBeUndefined();
  });

  it('warns, above the numbers, when the page is not connected', async () => {
    const body = autopilotBody();
    body.connected = false;
    body.dryRun = true;
    const { host } = await mounted({ body });
    const warn = host.find((n) => hasClass(n, 'la-note-warn'));
    expect(warn).toBeTruthy();
    expect(warn.textContent).toMatch(/not connected/i);

    /* Above the numbers, not below them: a caveat nobody scrolls to is not a
       caveat. Both nodes are children of the same wrapper, so their order in
       that list is the order they are painted in. */
    const wrap = host.children[0];
    const idx = (pred) => wrap.children.findIndex(pred);
    expect(idx((n) => hasClass(n, 'la-note-warn'))).toBeLessThan(idx((n) => hasClass(n, 'la-cards')));
  });

  it('says nothing about dry runs when the page is connected', async () => {
    const { host } = await mounted();
    expect(host.find((n) => hasClass(n, 'la-note-warn'))).toBeUndefined();
  });
});

/* ---------- the history ---------- */

describe('what it reports', () => {
  it('lists each post with its domain, a badge and a link out', async () => {
    const { host } = await mounted();
    const rows = host.findAll((n) => hasClass(n, 'la-row'));
    /* two published/failed plus one queued plus two forecast */
    expect(rows.length).toBe(5);

    const python = rows.find((r) => r.textContent.indexOf('Python Development') >= 0);
    expect(python.textContent).toContain('published');
    const link = python.find((n) => n.tagName === 'A');
    expect(link.attrs.href || link.href).toContain('linkedin.com');
    expect(link.attrs.rel || link.rel).toContain('noopener');
  });

  it('shows why a post did not send, instead of its text', async () => {
    const { host } = await mounted();
    const row = host.findAll((n) => hasClass(n, 'la-row')).find((r) => r.textContent.indexOf('HR') >= 0);
    expect(row.textContent).toContain('did not send');
    expect(row.textContent).toContain('LinkedIn refused the post');
  });

  it('marks a post that was recorded but never sent as a dry run', async () => {
    const body = autopilotBody();
    body.stats.recent[0].dryRun = true;
    const { host } = await mounted({ body });
    const row = host.findAll((n) => hasClass(n, 'la-row')).find((r) => r.textContent.indexOf('Python Development') >= 0);
    expect(row.textContent).toContain('dry run');
    expect(row.textContent).not.toContain('published');
  });

  it('names the domains coming up next, and where their posters live', async () => {
    const { host } = await mounted();
    const text = textOf(host);
    expect(text).toContain('Java Development');
    expect(text).toContain('Java Development Intern');
    const imgs = host.findAll((n) => n.tagName === 'IMG');
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs.map((i) => i.src)).toContain('/assets/linkedin-posters/python.jpg');
    expect(imgs.map((i) => i.src)).toContain('/assets/linkedin-posters/java.jpg');
    /* Decorative: the domain is already written next to it in words. */
    imgs.forEach((i) => expect(i.alt).toBe(''));
  });

  it('says so, rather than showing nothing, before the first post has gone out', async () => {
    const body = autopilotBody();
    body.stats.published = 0;
    body.stats.total = 0;
    body.stats.recent = [];
    body.stats.upcoming = [];
    const { host } = await mounted({ body });
    expect(host.find((n) => hasClass(n, 'la-empty'))).toBeTruthy();
    expect(textOf(host)).toMatch(/Nothing has gone out yet/i);
  });

  it('renders an excerpt containing markup as text, never as elements', async () => {
    const body = autopilotBody();
    body.stats.recent[0].excerpt = '<script>alert(1)</script><b>bold</b>';
    const { host } = await mounted({ body });
    expect(textOf(host)).toContain('<script>alert(1)</script>');
    expect(host.find((n) => n.tagName === 'SCRIPT')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'B')).toBeUndefined();
  });

  it('shows a domain it does not recognise without a broken poster', async () => {
    const body = autopilotBody();
    body.stats.recent[0].domain = 'Underwater Basket Weaving';
    const { host } = await mounted({ body });
    const row = host.findAll((n) => hasClass(n, 'la-row')).find((r) => r.textContent.indexOf('Basket') >= 0);
    expect(row).toBeTruthy();
    expect(row.find((n) => n.tagName === 'IMG').src).toBe('');
  });
});

/* ---------- failure ---------- */

describe('when the server will not answer', () => {
  it('explains an expired session rather than showing an empty panel', async () => {
    const { host } = await mounted({ status: 401 });
    const err = host.find((n) => hasClass(n, 'la-err'));
    expect(err).toBeTruthy();
    expect(err.textContent).toMatch(/session has expired/i);
  });

  it('explains a 403 in terms of who the section is for', async () => {
    const { host } = await mounted({ status: 403 });
    expect(host.find((n) => hasClass(n, 'la-err')).textContent).toMatch(/HR, coordinators, mentors and founders/i);
  });

  it('reports any other failure with its status code', async () => {
    const { host } = await mounted({ status: 500 });
    expect(host.find((n) => hasClass(n, 'la-err')).textContent).toContain('500');
  });

  it('re-renders rather than stacking when the tab is opened twice', async () => {
    const { context, host, server } = await mounted();
    context.window.TENLinkedInAgent.mount(host, { headers: { Authorization: 'Bearer test-token' } });
    await settle();
    expect(server.calls).toHaveLength(2);
    expect(host.findAll((n) => hasClass(n, 'la-title'))).toHaveLength(1);
  });
});
