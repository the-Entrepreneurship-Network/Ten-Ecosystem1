'use strict';

/**
 * The Studio paywall.
 *
 * `express.static("public")` serves /job-portal and /resume-portal to anybody
 * who types the URL — two products with prices on them were a bookmark away
 * from free. A paywall that only exists as a button on a page is not a
 * paywall.
 */

jest.mock('../../services/studioAccess', () => ({ canOpen: jest.fn() }));
jest.mock('../../models/Student', () => ({ findOne: jest.fn(), findById: jest.fn() }));

const studioAccess = require('../../services/studioAccess');
const Student = require('../../models/Student');
const { studioGate, studioApi, portalFor, GUARDED } = require('../../middleware/studioGate');

const lean = (v) => ({ lean: () => Promise.resolve(v) });

function run(reqOver = {}) {
  const req = { method: 'GET', path: '/job-portal/', originalUrl: '/job-portal/',
                session: { student: { employeeId: 'TEN/WEB/1' } }, ...reqOver };
  const res = { redirect: jest.fn(), statusCode: 0 };
  const next = jest.fn();
  return studioGate(req, res, next).then(() => ({ res, next }));
}

beforeEach(() => {
  studioAccess.canOpen.mockReset().mockResolvedValue(false);
  Student.findOne.mockReset().mockReturnValue(lean({ _id: 'stu1', employeeId: 'TEN/WEB/1' }));
  Student.findById.mockReset().mockReturnValue(lean(null));
});

describe('what it stands in front of', () => {
  it.each([
    ['/job-portal', 'job'],
    ['/job-portal/', 'job'],
    ['/job-portal/assets/index.js', 'job'],
    ['/resume-portal/', 'resume']
  ])('%s belongs to the %s portal', (path, portal) => {
    expect(portalFor(path)).toBe(portal);
  });

  /*
   * The overview is the shop window. A visitor has to be able to see what the
   * money buys, or nobody buys it — and the whole reason the flow was rebuilt
   * is "first they get the overview, then they pay".
   */
  /*
   * /domains is the list a visitor picks a track from, and student-journeys
   * — which the course used to be guarded by — is gone. Gating the chooser
   * would put a paywall in front of the menu.
   */
  it('leaves the overview and the domain chooser open to everyone', () => {
    expect(portalFor('/domains')).toBeNull();
    expect(portalFor('/student-journeys.html')).toBeNull();
    expect(portalFor('/student-portal/')).toBeNull();
    expect(portalFor('/index.html')).toBeNull();
    expect(portalFor('/studio.html')).toBeNull();
    expect(portalFor('/academics.html')).toBeNull();
  });

  // A path that merely starts with the same letters is a different page.
  it('does not catch a lookalike path', () => {
    expect(portalFor('/job-portal-preview.html')).toBeNull();
    expect(portalFor('/resume-portalish')).toBeNull();
  });

  it('never lets the pay screen itself be gated, which would loop', () => {
    GUARDED.forEach(([prefix]) => expect('/studio.html'.startsWith(prefix)).toBe(false));
  });
});

describe('who gets through', () => {
  it('lets a paid student through to the file', async () => {
    studioAccess.canOpen.mockResolvedValue(true);
    const { res, next } = await run();
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('sends an unpaid student to the pay screen, saying what they wanted', async () => {
    const { res, next } = await run();
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302,
      '/studio.html?want=job&next=%2Fjob-portal%2F');
  });

  // Signed out is not the same as unpaid: they may already own it.
  it('sends a signed-out visitor to sign in, and back afterwards', async () => {
    const { res } = await run({ session: {} });
    expect(res.redirect).toHaveBeenCalledWith(302, '/login.html?next=%2Fjob-portal%2F');
  });

  it('ignores everything it does not guard', async () => {
    const { res, next } = await run({ path: '/index.html', originalUrl: '/index.html' });
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  // A POST under one of these paths is not a page and has its own guard.
  it('only judges page requests', async () => {
    const { next } = await run({ method: 'POST' });
    expect(next).toHaveBeenCalled();
  });
});

describe('when something goes wrong', () => {
  /*
   * Fail CLOSED. This is the one case where letting someone through is worse
   * than turning them away: the whole point of the file is that the product is
   * not free, and a paywall that opens on a database hiccup is a paywall with
   * a documented bypass.
   */
  it('turns them away rather than opening the door', async () => {
    studioAccess.canOpen.mockRejectedValue(new Error('mongo down'));
    const { res, next } = await run({ session: { student: { employeeId: 'TEN/WEB/1' } } });
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, '/studio.html?error=1');
  });

  it('sends an unknown session to sign in rather than through', async () => {
    Student.findOne.mockReturnValue(lean(null));
    const { res, next } = await run({ session: { student: { employeeId: 'ghost' } } });
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect.mock.calls[0][1]).toContain('/login.html');
  });
});

/*
 * The agents behind the pages. The page was paid for and the API it calls was
 * not: /api/v2/jobs and /api/v2/resume never looked at who was calling.
 */
describe('the portal API', () => {
  function call(portal, session) {
    const req = { method: 'POST', path: '/search', session };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    return studioApi(portal)(req, res, next).then(() => ({ res, next }));
  }

  it('answers a signed-out caller 401, and runs nothing', async () => {
    const { res, next } = await call('job', {});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0]).toMatchObject({ ok: false, signIn: '/login.html' });
  });

  it('answers a student without the portal 403, with where to get it', async () => {
    const { res, next } = await call('resume', { student: { employeeId: 'TEN/WEB/1' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ ok: false, buy: '/studio.html?want=resume' });
    expect(res.json.mock.calls[0][0].error).toMatch(/Resume Portal/);
  });

  it('lets a student who has it through', async () => {
    studioAccess.canOpen.mockResolvedValue(true);
    const { res, next } = await call('job', { student: { employeeId: 'TEN/WEB/1' } });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(studioAccess.canOpen).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 'TEN/WEB/1' }), 'job');
  });

  it('checks an Academic Portal learner, who has no Student row', async () => {
    studioAccess.canOpen.mockResolvedValue(true);
    const { next } = await call('job', { learner: { id: 'L1', email: 'a@b.c', name: 'A' } });
    expect(next).toHaveBeenCalled();
    expect(studioAccess.canOpen).toHaveBeenCalledWith(expect.objectContaining({ _id: 'L1', employeeId: null }), 'job');
  });

  it('fails closed with 503 when the check itself breaks', async () => {
    studioAccess.canOpen.mockRejectedValue(new Error('mongo down'));
    const { res, next } = await call('job', { student: { employeeId: 'TEN/WEB/1' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('stands in front of the job, resume and outreach APIs in server.js', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../server.js'), 'utf8');
    expect(src).toMatch(/app\.use\('\/api\/v2\/resume', studioApi\('resume'\), v2ResumeAgent\)/);
    expect(src).toMatch(/app\.use\('\/api\/v2\/jobs', studioApi\('job'\), v2JobAgent\)/);
    expect(src).toMatch(/app\.use\("\/api\/v2\/job-outreach", require\("\.\/middleware\/studioGate"\)\.studioApi\("job"\)/);
  });
});
