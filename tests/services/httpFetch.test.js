'use strict';

/**
 * The regression that cost the most: every job source was written against the
 * global `fetch`, which does not exist before Node 18. Production ran older
 * than that, so all nine sources threw "fetch is not defined" and the portal
 * reported zero openings — while the identical code passed on a laptop with a
 * newer runtime. These tests run with the global deleted, which is the only
 * way to catch it from a machine that has one.
 */

describe('httpFetch on a runtime without global fetch', () => {
  const realFetch = globalThis.fetch;
  let httpFetch;
  let server;
  let base;

  beforeAll(async () => {
    /* The condition production was in. */
    delete globalThis.fetch;
    jest.resetModules();
    ({ httpFetch } = require('../../services/v2/httpFetch'));

    const http = require('http');
    server = http.createServer((req, res) => {
      if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobs: [{ title: 'Backend Engineer' }] }));
      } else if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/landed' });
        res.end();
      } else if (req.url === '/landed') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('arrived');
      } else if (req.url === '/missing') {
        res.writeHead(404); res.end('nope');
      } else if (req.url === '/slow') {
        setTimeout(() => { res.writeHead(200); res.end('late'); }, 3000);
      } else {
        res.writeHead(200, { 'x-custom': 'yes' }); res.end('ok');
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (realFetch) globalThis.fetch = realFetch;
    await new Promise((r) => server.close(r));
  });

  it('exists at all — the thing production was missing', () => {
    expect(globalThis.fetch).toBeUndefined();
    expect(typeof httpFetch).toBe('function');
  });

  it('reads JSON, which is how every job board answers', async () => {
    const res = await httpFetch(`${base}/json`);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jobs[0].title).toBe('Backend Engineer');
  });

  it('follows redirects and reports where it landed', async () => {
    const res = await httpFetch(`${base}/redirect`);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe('arrived');
    /* The final URL is how a board link is recognised as having left the board. */
    expect(res.url).toContain('/landed');
  });

  it('reports a 404 as not ok rather than throwing', async () => {
    const res = await httpFetch(`${base}/missing`);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('times out without AbortSignal, which old Node also lacks', async () => {
    await expect(httpFetch(`${base}/slow`, { timeoutMs: 300 })).rejects.toThrow(/timeout/i);
  });

  it('exposes response headers the callers read', async () => {
    const res = await httpFetch(`${base}/plain`);
    expect(res.headers.get('x-custom')).toBe('yes');
  });

  it('the job services call out without a ReferenceError', async () => {
    /* Requiring them is not enough — the failure was at call time, so each
       one has to actually make a request. Pointed at the local server so the
       test proves the runtime, not the internet. */
    const direct = require('../../services/v2/jobDirectLink');
    const out = await direct.resolveDirectUrl({ url: `${base}/plain` }, { timeoutMs: 1500 });
    expect(out === null || typeof out === 'object').toBe(true);

    const boards = require('../../services/v2/atsBoards');
    /* A board fetch on this runtime must fail as a network error, never as
       "fetch is not defined" — that distinction is the whole bug. */
    await expect(boards.fromGreenhouse('definitely-not-a-real-company', { timeoutMs: 1500 }))
      .rejects.not.toThrow(/fetch is not defined/);
  }, 15000);
});
