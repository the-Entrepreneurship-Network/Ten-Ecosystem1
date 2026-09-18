'use strict';

/**
 * The LinkedIn Agent panel, run for real.
 *
 * public/linkedin-agent.js is a browser IIFE with no build step and no
 * framework, so there is nothing to import: the file is read as text, parsed
 * by the vm module (a syntax error fails here, not in someone's browser), and
 * executed against a fake window whose document hands out plain objects that
 * remember their children, attributes and listeners. That is enough to mount
 * the panel, type into it, click its chips, and watch what it sends — every
 * request must go to /api/v2/linkedin and carry the dashboard's auth header,
 * and "post now" must carry the rasterised poster only when there is one to
 * carry.
 *
 * The static checks are the ones a reviewer would otherwise repeat by eye:
 * no innerHTML (a draft containing "<script>" must render as text), no inline
 * on*= handler strings, no secrets, and every class name prefixed la- so the
 * injected stylesheet cannot restyle the dashboard around it.
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
      _text: '', className: '', id: '', hidden: false, disabled: false, value: '', placeholder: '',
      scrollTop: 0, scrollHeight: 60, width: 0, height: 0, src: '',
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
      set textContent(v) { this._text = String(v); this.children = []; },
      get firstChild() { return this.children[0] || null; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      dispatch(type, evt) { (this.listeners[type] || []).forEach((fn) => fn(Object.assign({ target: this, preventDefault() {} }, evt || {}))); },
      focus() {},
      /* canvas */
      getContext() { return { drawImage() {} }; },
      toDataURL() { return 'data:image/png;base64,iVBORw0KGgoFAKEPNG'; },
      /* helpers for the tests */
      find(pred) { return all.find((n) => n !== this && contains(this, n) && pred(n)); },
      findAll(pred) { return all.filter((n) => n !== this && contains(this, n) && pred(n)); },
    };
    all.push(node);
    return node;
  }
  function contains(root, n) { for (let p = n.parentNode; p; p = p.parentNode) if (p === root) return true; return false; }
  const document = {
    head: element('head'),
    body: element('body'),
    createElement: element,
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [], parentNode: null }),
    getElementById: () => null,
  };
  return { document, all };
}

/* <img>: setting src "loads" on the next tick, like a data: URL would. */
class FakeImage {
  constructor() { this.listeners = {}; this._src = ''; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  set src(v) { this._src = v; setTimeout(() => (this.listeners.load || []).forEach((fn) => fn()), 0); }
  get src() { return this._src; }
}

function makeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m };
}

/*
 * A server that answers the way routes/v2/linkedinAgent.js does. Each test
 * can swap `replies.chat` to shape the next agent turn.
 */
function makeServer() {
  const calls = [];
  const replies = {
    status: { ok: true, role: 'hr', name: 'HR One', linkedin: { configured: false, source: 'none' }, llm: null, scheduler: { enabled: false } },
    posts: { ok: true, posts: [] },
    chat: { ok: true, kind: 'help', reply: 'I can draft, review and post.', session: {} },
  };
  const fetch = (url, init) => {
    calls.push({ url, init: init || {} });
    const key = /\/status/.test(url) ? 'status' : /\/posts/.test(url) ? 'posts' : 'chat';
    /* The body is looked up when json() is read, not when fetch is called:
       mount fires /status and /posts synchronously, before a test has had a
       chance to say what the server should answer. */
    const body = () => (typeof replies[key] === 'function' ? replies[key](url, init) : replies[key]);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body()) });
  };
  return { calls, replies, fetch };
}

function boot(opts = {}) {
  const dom = makeDom();
  const server = makeServer();
  const storage = makeStorage();
  const context = {
    console, setTimeout, clearTimeout,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Image: FakeImage,
    localStorage: storage,
    location: { href: '' },
    document: dom.document,
    fetch: server.fetch,
  };
  context.window = context;
  vm.createContext(context);
  new vm.Script(SRC, { filename: 'linkedin-agent.js' }).runInContext(context);
  const host = dom.document.createElement('div');
  context.window.TENLinkedInAgent.mount(host, Object.assign({ headers: { Authorization: 'Bearer test-token' }, role: 'hr' }, opts));
  return { context, dom, server, storage, host };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

const textarea = (host) => host.find((n) => n.tagName === 'TEXTAREA');
const sendButton = (host) => host.find((n) => n.attrs['aria-label'] === 'Send message');
const chatCalls = (server) => server.calls.filter((c) => /\/chat$/.test(c.url));
const lastChatBody = (server) => JSON.parse(chatCalls(server).slice(-1)[0].init.body);
const hasClass = (n, c) => String(n.className || '').split(/\s+/).includes(c);

async function type(host, message) {
  const ta = textarea(host);
  ta.value = message;
  ta.dispatch('keydown', { key: 'Enter', shiftKey: false });
  await settle();
}

const LONG_POST = 'Ten interns, one summer, and the question every fresher asks: does a virtual internship actually count? It does when the work is real. ' +
  'This cohort shipped a working Python service, presented it to mentors, and two of them have offers already.\n\nApply for the next batch at https://virtualinternships.entrepreneurshipnetwork.net\n\n#TheEntrepreneurshipNetwork #TEN #Internships #Freshers';

const REVIEW_REPLY = {
  ok: true, kind: 'review',
  reply: 'One thing to fix, then it is ready.\n\nHere is the version I will post:',
  session: { draft: 'x', final: LONG_POST, kind: 'leadgen' },
  review: { verdict: 'revise', kind: 'leadgen', original: 'x', final: LONG_POST, chars: LONG_POST.length,
    issues: [{ code: 'exclamation_overload', severity: 'revise', excerpt: 'Apply now!!!', message: 'Three exclamation marks in a row.', fix: 'One is enough.' }] },
  post: { text: LONG_POST, hashtags: ['#TheEntrepreneurshipNetwork', '#TEN', '#Internships', '#Freshers'], chars: LONG_POST.length, kind: 'leadgen' },
  poster: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><text>₹5,000</text></svg>', template: 'leadgen', width: 1200, height: 1200, alt: 'TEN poster', withImage: true },
  options: { options: [{ label: 'Post now', value: 'post now' }, { label: 'Schedule', value: 'schedule tomorrow 10am' }, { label: 'Shorter', value: 'shorter', note: 'under 900' }] },
};

/* ---------- static ---------- */

describe('public/linkedin-agent.js (static)', () => {
  it('parses and defines window.TENLinkedInAgent.mount', () => {
    expect(() => new vm.Script(SRC, { filename: 'linkedin-agent.js' })).not.toThrow();
    const { context } = boot();
    expect(typeof context.window.TENLinkedInAgent.mount).toBe('function');
    expect(SRC.startsWith('/*')).toBe(true);
    expect(SRC).toContain('"use strict";');
  });

  it('never assigns innerHTML and never wires a handler as a string', () => {
    expect(SRC).not.toMatch(/innerHTML\s*=\s*[^'"`]/);
    expect(SRC).not.toMatch(/\.innerHTML\b/);
    expect(SRC).not.toMatch(/\bouterHTML\b|insertAdjacentHTML|document\.write/);
    expect(SRC).not.toMatch(/\son[a-z]+\s*=\s*["'`]/i);
    expect(SRC).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    expect(SRC).toContain('addEventListener(');
  });

  it('carries no secrets, only the auth header the dashboard hands it', () => {
    expect(SRC).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(SRC).not.toMatch(/AQV[A-Za-z0-9_-]{20,}/);
    expect(SRC).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
    expect(SRC).not.toMatch(/LINKEDIN_ACCESS_TOKEN|CLIENT_SECRET|OPENAI_API_KEY|GEMINI_API_KEY/);
    expect(SRC).not.toMatch(/api\.linkedin\.com|api\.openai\.com/);
  });

  it('talks only to /api/v2/linkedin', () => {
    expect(SRC).toMatch(/var API = "\/api\/v2\/linkedin";/);
    const fetches = SRC.match(/\bfetch\s*\(/g) || [];
    expect(fetches.length).toBeGreaterThan(0);
    expect(SRC.match(/\bfetch\s*\(\s*API \+ /g) || []).toHaveLength(fetches.length);
    expect(SRC).toContain('API + "/oauth/start"');
    expect(SRC).not.toMatch(/fetch\s*\(\s*["'`]/);
  });

  it('prefixes every class it styles with la- so the stylesheet cannot leak', () => {
    const css = SRC.slice(SRC.indexOf('var CSS = ['), SRC.indexOf('].join("\\n");'));
    expect(css.length).toBeGreaterThan(1000);
    const selectors = css.match(/\.[A-Za-z_][\w-]*/g) || [];
    expect(selectors.length).toBeGreaterThan(50);
    selectors.forEach((s) => expect(s).toMatch(/^\.la(?:-|$)/));
    expect(SRC).toContain('prefers-reduced-motion');
    expect(SRC).toContain(':focus-visible');
    expect(SRC).not.toContain('transition:all');
    expect(SRC).toContain('@media(max-width:900px)');
  });
});

/* ---------- mounted ---------- */

describe('mounting', () => {
  it('asks for status and recent posts with the dashboard headers', async () => {
    const { server } = boot();
    await settle();
    const urls = server.calls.map((c) => c.url);
    expect(urls).toContain('/api/v2/linkedin/status');
    expect(urls.some((u) => u.startsWith('/api/v2/linkedin/posts?limit='))).toBe(true);
    server.calls.forEach((c) => {
      expect(c.url.startsWith('/api/v2/linkedin/')).toBe(true);
      expect(c.init.headers.Authorization).toBe('Bearer test-token');
      expect(c.init.credentials).toBe('same-origin');
    });
  });

  it('explains dry run when LinkedIn is not connected and offers Connect to HR', async () => {
    const { host, context } = boot({ role: 'hr' });
    await settle();
    expect(host.textContent).toContain('Not connected');
    expect(host.textContent).toContain('nothing is sent to LinkedIn');
    const connect = host.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Connect LinkedIn');
    expect(connect).toBeTruthy();
    expect(connect.attrs.type).toBe('button');
    connect.dispatch('click');
    expect(context.location.href).toBe('/api/v2/linkedin/oauth/start');
  });

  it('shows no Connect button to a mentor, coordinator or founder', async () => {
    for (const role of ['mentor', 'coordinator', 'founder']) {
      const { host } = boot({ role });
      await settle();
      expect(host.find((n) => n.tagName === 'BUTTON' && /Connect LinkedIn/.test(n.textContent))).toBeUndefined();
    }
  });

  it('reads the connected and expiring states from /status', async () => {
    const a = boot();
    a.server.replies.status = { ok: true, linkedin: { configured: true, orgName: 'The Entrepreneurship Network', orgUrn: 'urn:li:organization:123', expiresInDays: 41 }, llm: 'openai', scheduler: { enabled: true } };
    await settle();
    expect(a.host.textContent).toContain('Connected to The Entrepreneurship Network');
    expect(a.host.textContent).toContain('expires in 41 days');
    expect(a.host.textContent).toContain('OpenAI');
    expect(a.host.find((n) => n.textContent === 'Reconnect LinkedIn')).toBeTruthy();

    const b = boot();
    b.server.replies.status = { ok: true, linkedin: { configured: true, expiresInDays: 3, warning: 'Token expires in 3 days' }, llm: null };
    await settle();
    expect(b.host.textContent).toContain('expiring soon');
    expect(b.host.find((n) => hasClass(n, 'la-warn'))).toBeTruthy();

    const c = boot();
    c.server.replies.status = { ok: true, linkedin: { configured: true, expiresInDays: 0 } };
    await settle();
    expect(c.host.textContent).toContain('Connection expired');
  });

  it('lists recent posts with a status badge and a link', async () => {
    const { host, server } = boot();
    server.replies.posts = { ok: true, posts: [
      { id: '1', kind: 'opening', status: 'published', final: 'We are hiring interns.', publishedAt: '2026-09-17T04:30:00.000Z', url: 'https://www.linkedin.com/feed/update/urn:li:share:1' },
      { id: '2', kind: 'placement', status: 'scheduled', final: 'Priya got placed.', scheduledFor: '2026-09-19T04:30:00.000Z' },
      { id: '3', kind: 'general', status: 'published', dryRun: true, final: 'Dry.' },
    ] };
    await settle();
    const badges = host.findAll((n) => hasClass(n, 'la-badge')).map((n) => n.textContent);
    expect(badges).toEqual(['published', 'scheduled', 'dry run']);
    const link = host.find((n) => n.tagName === 'A' && n.attrs.href === 'https://www.linkedin.com/feed/update/urn:li:share:1');
    expect(link).toBeTruthy();
    expect(link.attrs.rel).toContain('noopener');
  });
});

describe('a turn of the conversation', () => {
  it('Enter sends the draft with the session; Shift+Enter does not', async () => {
    const { host, server } = boot();
    await settle();
    const before = chatCalls(server).length;
    const ta = textarea(host);
    ta.value = 'line one';
    ta.dispatch('keydown', { key: 'Enter', shiftKey: true });
    await settle();
    expect(chatCalls(server).length).toBe(before);

    await type(host, 'We are hiring Python interns, remote, 2 months.');
    const body = lastChatBody(server);
    expect(body.message).toBe('We are hiring Python interns, remote, 2 months.');
    expect(body.session).toEqual({});
    expect(body.pngBase64).toBeUndefined();
    expect(host.textContent).toContain('We are hiring Python interns, remote, 2 months.');
    expect(host.textContent).toContain('I can draft, review and post.');
  });

  it('renders the review card and a LinkedIn-style preview with a see-more fold', async () => {
    const { host, server } = boot();
    server.replies.chat = REVIEW_REPLY;
    await settle();
    await type(host, 'some draft text long enough to review');

    const pill = host.find((n) => hasClass(n, 'la-pill-revise'));
    expect(pill).toBeTruthy();
    expect(pill.textContent).toBe('Revised');
    expect(host.textContent).toContain('exclamation overload');
    expect(host.textContent).toContain('One is enough.');

    const card = host.find((n) => hasClass(n, 'la-li'));
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('The Entrepreneurship Network');
    expect(card.textContent).toContain('46K followers');
    expect(card.find((n) => hasClass(n, 'la-li-avatar')).textContent).toBe('TEN');
    expect(card.textContent).toContain('Like');
    expect(card.textContent).toContain('Repost');

    /* folded: the hashtags at the end are not visible yet */
    expect(card.textContent).not.toContain('#Freshers');
    const more = card.find((n) => hasClass(n, 'la-li-more'));
    expect(more.textContent).toBe('…see more');
    more.dispatch('click');
    expect(card.textContent).toContain('#Freshers');
    const tags = card.findAll((n) => hasClass(n, 'la-tag')).map((n) => n.textContent);
    expect(tags).toContain('#TheEntrepreneurshipNetwork');
    expect(tags).toContain('#TEN');
    expect(card.find((n) => hasClass(n, 'la-li-more'))).toBeUndefined();

    const img = card.find((n) => n.tagName === 'IMG');
    expect(img.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(img.src.split(',')[1], 'base64').toString('utf8')).toContain('₹5,000');
    expect(host.find((n) => hasClass(n, 'la-meta') && /characters/.test(n.textContent)).textContent).toMatch(/4 hashtags · leadgen poster attached/);
  });

  it('a draft with markup renders as text, never as elements', async () => {
    const { host, server } = boot();
    const evil = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
    server.replies.chat = Object.assign({}, REVIEW_REPLY, { reply: 'Echo: ' + evil, post: { text: evil + ' #TEN', hashtags: ['#TEN'], chars: 60 } });
    await settle();
    await type(host, evil);
    /* nothing was ever parsed: the only IMG is the poster, with an SVG data URL */
    const imgs = host.findAll((n) => n.tagName === 'IMG');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].src.startsWith('data:image/svg+xml')).toBe(true);
    expect(host.findAll((n) => n.tagName === 'SCRIPT')).toHaveLength(0);
    expect(host.textContent).toContain('<script>alert(2)</script>');
  });

  it('option chips are buttons that send their value', async () => {
    const { host, server } = boot();
    server.replies.chat = REVIEW_REPLY;
    await settle();
    await type(host, 'draft');
    const chip = host.find((n) => hasClass(n, 'la-chip') && n.textContent.startsWith('Shorter'));
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.attrs.type).toBe('button');
    expect(chip.textContent).toContain('under 900');
    const primary = host.find((n) => hasClass(n, 'la-chip-primary') && n.textContent === 'Post now');
    expect(primary).toBeTruthy();
    server.replies.chat = { ok: true, kind: 'review', reply: 'Shorter version.', session: {} };
    chip.dispatch('click');
    await settle();
    expect(lastChatBody(server).message).toBe('shorter');
    expect(lastChatBody(server).session).toEqual({ draft: 'x', final: LONG_POST, kind: 'leadgen' });
  });

  it('remembers only the session blob in localStorage', async () => {
    const { host, server, storage } = boot();
    server.replies.chat = REVIEW_REPLY;
    await settle();
    await type(host, 'draft');
    expect(Array.from(storage._map.keys())).toEqual(['ten_linkedin_agent_session']);
    expect(JSON.parse(storage.getItem('ten_linkedin_agent_session'))).toEqual(REVIEW_REPLY.session);
  });

  it('shows the agent an error bubble, and recovers, when the server is down', async () => {
    const { host, server, context } = boot();
    await settle();
    context.fetch = () => Promise.reject(new Error('Failed to fetch'));
    await type(host, 'anything');
    expect(host.find((n) => hasClass(n, 'la-err')).textContent).toContain('Failed to fetch');
    expect(sendButton(host).disabled).toBe(false);
    context.fetch = server.fetch;
    await type(host, 'again');
    expect(lastChatBody(server).message).toBe('again');
  });
});

describe('posting', () => {
  it('rasterises the poster and sends pngBase64 with "post now" when the poster has an image', async () => {
    const { host, server } = boot();
    server.replies.chat = REVIEW_REPLY;
    await settle();
    await type(host, 'draft');
    server.replies.chat = { ok: true, kind: 'posted', reply: 'Posted.', session: {}, publish: { ok: false, dryRun: true, payload: { author: 'urn:li:organization:1', commentary: 'x', charCount: 1 } } };
    await type(host, 'post now');
    const body = lastChatBody(server);
    expect(body.message).toBe('post now');
    expect(body.pngBase64).toBe('iVBORw0KGgoFAKEPNG');
    /* the dry-run card shows exactly what would have gone out */
    expect(host.textContent).toContain('Dry run');
    expect(host.find((n) => n.tagName === 'PRE').textContent).toContain('urn:li:organization:1');
    /* and the recent-posts rail refreshes after a post */
    expect(server.calls.filter((c) => /\/posts\?/.test(c.url)).length).toBe(2);
  });

  it('sends no image when the poster is off, or after the poster has been spent', async () => {
    const { host, server } = boot();
    server.replies.chat = Object.assign({}, REVIEW_REPLY, { poster: Object.assign({}, REVIEW_REPLY.poster, { withImage: false }) });
    await settle();
    await type(host, 'draft');
    expect(host.find((n) => hasClass(n, 'la-li')).find((n) => n.tagName === 'IMG')).toBeUndefined();
    server.replies.chat = { ok: true, kind: 'posted', reply: 'Posted.', session: {} };
    await type(host, 'yes');
    expect(lastChatBody(server).pngBase64).toBeUndefined();

    /* a fresh draft after a post: the old poster must not ride along */
    server.replies.chat = REVIEW_REPLY;
    await type(host, 'draft two');
    server.replies.chat = { ok: true, kind: 'posted', reply: 'Posted.', session: {} };
    await type(host, 'publish');
    expect(lastChatBody(server).pngBase64).toBe('iVBORw0KGgoFAKEPNG');
    server.replies.chat = { ok: true, kind: 'help', reply: 'help', session: {} };
    await type(host, 'post now');
    expect(lastChatBody(server).pngBase64).toBeUndefined();
  });

  it('still sends when rasterisation fails', async () => {
    const { host, server, context } = boot();
    context.Image = class { addEventListener(type, fn) { if (type === 'error') setTimeout(fn, 0); } set src(v) { this._s = v; } };
    server.replies.chat = REVIEW_REPLY;
    await settle();
    await type(host, 'draft');
    server.replies.chat = { ok: true, kind: 'posted', reply: 'Posted.', session: {} };
    await type(host, 'post it');
    const body = lastChatBody(server);
    expect(body.message).toBe('post it');
    expect(body.pngBase64).toBeUndefined();
  });

  it('quick starts set the kind hint without a round trip; Help sends "help"', async () => {
    const { host, server } = boot();
    await settle();
    const before = chatCalls(server).length;
    host.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Internship opening').dispatch('click');
    await settle();
    expect(chatCalls(server).length).toBe(before);
    expect(host.textContent).toContain('apply-by date');
    expect(textarea(host).placeholder).toContain('Hiring');
    await type(host, 'Hiring Python interns, remote, 2 months');
    expect(lastChatBody(server).session.kindHint).toBe('opening');

    host.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Help').dispatch('click');
    await settle();
    expect(lastChatBody(server).message).toBe('help');
  });
});
