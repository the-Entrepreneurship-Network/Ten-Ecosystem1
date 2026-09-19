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
 * What the section is now is a feed of the posts the company page has already
 * published, shown in every portal to everybody who signs in. So the tests are
 * about what it renders rather than what it sends. Two of them matter more
 * than the rest:
 *
 *   - it must offer no way to write a post. No textarea, no send button, no
 *     form. The agent posts by itself; a text box here would be a second,
 *     unrotated route to the company page.
 *   - a post the server flagged as recorded-but-never-sent must not be shown
 *     as one the public saw. Students read this section now, and a badge is
 *     the difference between reporting and misreporting.
 *
 * The static checks are the ones a reviewer would otherwise repeat by eye: no
 * innerHTML (post text containing "<script>" must render as text), no inline
 * on*= handler strings, no secrets, every class name prefixed la- so the
 * injected stylesheet cannot restyle the portal around it, and no request to
 * anything but the one endpoint every role may read.
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

/* The answer routes/v2/linkedinAgent.js gives GET /feed. Tests reshape this
   before mounting; the connect fields are only ever sent to HR and admin, so
   they are absent here by default. */
function feedBody() {
  return {
    ok: true,
    count: 9,
    posts: [
      {
        id: 'a1',
        domain: 'Python Development',
        text: '🚀 WE ARE #HIRING #INTERNS | The Entrepreneurship Network (TEN)\n\nWe are looking for Python Development Interns.\n\n💰 Stipend: Unpaid',
        image: '/assets/linkedin-posters/python.jpg',
        alt: 'Hiring poster: Python Development Intern, Remote, stipend Unpaid.',
        at: '2026-09-13T04:30:00.000Z',
        url: 'https://www.linkedin.com/feed/update/urn:li:share:7/',
        live: true,
      },
      {
        id: 'a2',
        domain: 'Web Development',
        text: 'a short one',
        image: '/assets/linkedin-posters/web.jpg',
        alt: '',
        at: '2026-09-12T04:30:00.000Z',
        url: '',
        live: false,
      },
    ],
  };
}

/* Long enough to fold: the module's threshold is 320 characters. */
const LONG_POST = [
  '🚀 WE ARE #HIRING #INTERNS | The Entrepreneurship Network (TEN)',
  '',
  'We are looking for Cyber Security Interns to join The Entrepreneurship Network (TEN).',
  '',
  'No course to sit through first, no training block before you are allowed to touch anything real. From week one you are on an industry-level project, and the project is the training: you learn here by building and shipping, with a coordinator reviewing your work every week.',
  '',
  '💰 Stipend: Unpaid',
  '',
  '🔗 Apply for Cyber Security here: https://lnkd.in/gK5Cna3c',
].join('\n');

function makeServer(body) {
  const calls = [];
  const state = { body: body || feedBody(), ok: true, status: 200 };
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
const cards = (host) => host.findAll((n) => hasClass(n, 'la-post'));

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

  it('carries no secrets, only the auth header the portal hands it', () => {
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
   * browser too, and now that the section is in front of students it has to
   * stay gone. A text box wired to a 404 reads, to whoever is looking at it,
   * as the feature being broken rather than as the feature having changed.
   */
  it('has no composing surface left in the source at all', () => {
    expect(SRC).not.toMatch(/createElement\(\s*['"]textarea['"]/i);
    expect(SRC).not.toMatch(/\/chat\b/);
    expect(SRC).not.toMatch(/pngBase64/);
    expect(SRC).not.toMatch(/method:\s*['"](PUT|DELETE|PATCH)['"]/);
  });

  /*
   * There is one POST, and it carries a credential rather than a post: the
   * connect form, which HR and admin use to put the access token in without
   * needing a shell on the server. It must never leave the token anywhere it
   * could outlive the submit.
   */
  it('the only POST is connect, and it does not stash the token', () => {
    /* Comments stripped first. The prose in this file names localStorage and
       data attributes in order to say it does not use them, and a check that
       matched the comment would be a test passing on its own documentation. */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const bodies = code.match(/JSON\.stringify\([^)]*\)/g) || [];
    expect(bodies.join(' ')).toMatch(/token/);
    expect(code).not.toMatch(/localStorage|sessionStorage/);
    /*
     * The token VALUE must never reach an attribute or a dataset, where it
     * would sit in the DOM for anything on the page to read. Matched on the
     * variable being passed, not on the word appearing in a string: the input
     * carries aria-label="LinkedIn access token", which is the right label and
     * not a leak.
     */
    expect(code).not.toMatch(/setAttribute\([^,]+,\s*token\b/);
    expect(code).not.toMatch(/\.dataset\.\w+\s*=\s*token\b/);
    expect(code).not.toMatch(/\.value\s*=\s*token\b/);
    /* Not left readable on a shared screen... */
    expect(SRC).toMatch(/input\.type\s*=\s*'password'/);
    /* ...and cleared from the field once it has been handed over. */
    expect(SRC).toMatch(/input\.value\s*=\s*''/);
  });
});

/* ---------- mounting ---------- */

describe('mounting', () => {
  it('asks the feed endpoint once, with the portal headers', async () => {
    const { server } = await mounted();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].url).toBe('/api/v2/linkedin/feed');
    expect(server.calls[0].init.headers.Authorization).toBe('Bearer test-token');
    expect(server.calls[0].init.credentials).toBe('same-origin');
  });

  /* Only the HR portal has a token. Every other portal — including the student
     dashboard — authenticates with the session cookie alone. */
  it('sends no Authorization header when the portal has none to give', async () => {
    const { server } = await mounted({ options: { headers: undefined, role: 'student' } });
    expect(server.calls[0].init.headers.Authorization).toBeUndefined();
    expect(server.calls[0].init.credentials).toBe('same-origin');
  });

  it('offers nothing to type into and nothing to press but Show more', async () => {
    const { host } = await mounted();
    expect(host.find((n) => n.tagName === 'TEXTAREA')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'INPUT')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'FORM')).toBeUndefined();
    host.findAll((n) => n.tagName === 'BUTTON').forEach((b) => {
      expect(hasClass(b, 'la-more')).toBe(true);
    });
  });

  it('says how many posts have gone out and how often they go', async () => {
    const { host } = await mounted();
    const text = textOf(host);
    expect(text).toContain('9 posts');
    expect(text).toMatch(/every two hours/i);
  });

  it('re-renders rather than stacking when the section is opened twice', async () => {
    const { context, host, server } = await mounted();
    context.window.TENLinkedInAgent.mount(host, {});
    await settle();
    expect(server.calls).toHaveLength(2);
    expect(host.findAll((n) => hasClass(n, 'la-title'))).toHaveLength(1);
    expect(cards(host)).toHaveLength(2);
  });
});

/* ---------- the posts ---------- */

describe('the posts', () => {
  it('shows one card per post, with its poster and a link out', async () => {
    const { host } = await mounted();
    const list = cards(host);
    expect(list).toHaveLength(2);

    const python = list.find((c) => c.textContent.indexOf('Python Development') >= 0);
    const img = python.find((n) => n.tagName === 'IMG');
    expect(img.src).toBe('/assets/linkedin-posters/python.jpg');
    /* The poster carries the role, the stipend and the eligibility, none of
       which a screen reader can read off a JPEG. */
    expect(img.alt).toContain('stipend Unpaid');

    const link = python.find((n) => n.tagName === 'A');
    expect(link.href).toContain('linkedin.com');
    expect(link.rel).toContain('noopener');
  });

  it('shows the post text, not a summary of it', async () => {
    const { host } = await mounted();
    const text = textOf(host);
    expect(text).toContain('WE ARE #HIRING #INTERNS');
    expect(text).toContain('Stipend: Unpaid');
  });

  it('marks a post that was recorded but never sent', async () => {
    const { host } = await mounted();
    const list = cards(host);
    expect(list.find((c) => c.textContent.indexOf('Python Development') >= 0).textContent).toContain('Posted');
    expect(list.find((c) => c.textContent.indexOf('Web Development') >= 0).textContent).toContain('Not on LinkedIn yet');
  });

  it('gives a post with no poster a card rather than a broken image', async () => {
    const body = feedBody();
    body.posts[0].image = '';
    const { host } = await mounted({ body });
    const card = cards(host).find((c) => c.textContent.indexOf('Python Development') >= 0);
    expect(card).toBeTruthy();
    expect(card.find((n) => n.tagName === 'IMG')).toBeUndefined();
  });

  it('drops a poster that fails to load rather than leaving a gap', async () => {
    const { host } = await mounted();
    const img = host.find((n) => n.tagName === 'IMG');
    expect(typeof img.onerror).toBe('function');
    img.onerror();
    expect(host.findAll((n) => n.tagName === 'IMG' && n.parentNode)).toHaveLength(1);
  });

  it('omits the footer link for a post that never reached LinkedIn', async () => {
    const { host } = await mounted();
    const web = cards(host).find((c) => c.textContent.indexOf('Web Development') >= 0);
    expect(web.find((n) => n.tagName === 'A')).toBeUndefined();
  });

  it('renders text containing markup as text, never as elements', async () => {
    const body = feedBody();
    body.posts[0].text = '<script>alert(1)</script><b>bold</b>';
    body.posts[0].domain = '<img src=x onerror=1>';
    const { host } = await mounted({ body });
    expect(textOf(host)).toContain('<script>alert(1)</script>');
    expect(host.find((n) => n.tagName === 'SCRIPT')).toBeUndefined();
    expect(host.find((n) => n.tagName === 'B')).toBeUndefined();
  });
});

/* ---------- folding ---------- */

describe('a long post', () => {
  async function longOne() {
    const body = feedBody();
    body.posts = [Object.assign({}, body.posts[0], { text: LONG_POST, domain: 'Cyber Security' })];
    return mounted({ body });
  }

  it('is folded, showing the top of it and offering the rest', async () => {
    const { host } = await longOne();
    const more = host.find((n) => hasClass(n, 'la-more'));
    expect(more).toBeTruthy();
    expect(more.textContent).toBe('Show more');
    expect(more.attrs['aria-expanded']).toBe('false');

    const body = host.find((n) => hasClass(n, 'la-text')).textContent;
    expect(body).toContain('WE ARE #HIRING');
    expect(body).not.toContain('Apply for Cyber Security here');
    expect(body).toContain('…');
    expect(body.length).toBeLessThan(LONG_POST.length);
  });

  it('opens and closes again in place, with no second request', async () => {
    const { host, server } = await longOne();
    const more = host.find((n) => hasClass(n, 'la-more'));

    more.dispatch('click');
    expect(textOf(host)).toContain('Apply for Cyber Security here');
    expect(more.textContent).toBe('Show less');
    expect(more.attrs['aria-expanded']).toBe('true');

    more.dispatch('click');
    expect(textOf(host)).not.toContain('Apply for Cyber Security here');
    expect(more.textContent).toBe('Show more');
    expect(server.calls).toHaveLength(1);
  });

  it('leaves a short post whole, with nothing to press', async () => {
    const body = feedBody();
    body.posts = [Object.assign({}, body.posts[0], { text: 'three words only' })];
    const { host } = await mounted({ body });
    expect(host.find((n) => hasClass(n, 'la-more'))).toBeUndefined();
    expect(textOf(host)).toContain('three words only');
  });
});

/* ---------- who sees what ---------- */

describe('what each role is shown', () => {
  it('tells HR when the page still needs connecting', async () => {
    const body = feedBody();
    body.canConnect = true;
    body.connected = false;
    const { host } = await mounted({ body });
    const warn = host.find((n) => hasClass(n, 'la-note-warn'));
    expect(warn).toBeTruthy();
    expect(warn.textContent).toMatch(/not connected/i);
  });

  /*
   * A student's payload has no connect fields at all, so the warning cannot
   * appear for them even if the page were somehow not connected — which is
   * right: it is not a student's problem and not a student's to fix.
   */
  it('says nothing about connecting to anybody the server did not tell', async () => {
    const { host } = await mounted();
    expect(host.find((n) => hasClass(n, 'la-note-warn'))).toBeUndefined();

    const body = feedBody();
    body.connected = false;
    const second = await mounted({ body });
    expect(second.host.find((n) => hasClass(n, 'la-note-warn'))).toBeUndefined();
  });

  it('says so, rather than showing nothing, before the first post has gone out', async () => {
    const { host } = await mounted({ body: { ok: true, count: 0, posts: [] } });
    expect(host.find((n) => hasClass(n, 'la-empty'))).toBeTruthy();
    expect(textOf(host)).toMatch(/Nothing has gone out yet/i);
    expect(cards(host)).toHaveLength(0);
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

  it('explains a 403 without blaming the reader', async () => {
    const { host } = await mounted({ status: 403 });
    expect(host.find((n) => hasClass(n, 'la-err')).textContent).toMatch(/not available on your account/i);
  });

  it('reports any other failure with its status code', async () => {
    const { host } = await mounted({ status: 500 });
    expect(host.find((n) => hasClass(n, 'la-err')).textContent).toContain('500');
  });
});
