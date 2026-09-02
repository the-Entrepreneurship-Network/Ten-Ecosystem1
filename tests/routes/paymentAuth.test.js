'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const payment = strip(fs.readFileSync(path.join(root, 'routes/v2/payment.js'), 'utf8'));
const server = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));

describe('nobody can approve a payment by saying they are HR', () => {
  /*
   * THE HOLE. Every one of these routes guarded itself with
   *
   *     req.headers.authorization.startsWith('Bearer hr_')
   *
   * — a prefix test with no token, no lookup and no session, which the literal
   * string "Bearer hr_" satisfied. Anyone able to reach the server could approve
   * any payment, and the name written into the approval record was whatever they
   * put after the underscore, so the audit trail was attacker-controlled too.
   *
   * The same hole was found and closed in hr.js, documents.js, certificates.js
   * and coordinator.js. These were missed.
   */
  it('no route trusts an Authorization prefix', () => {
    expect(payment).not.toMatch(/startsWith\(['"]Bearer hr_/);
    expect(server).not.toMatch(/indexOf\(["']Bearer hr_["']\)\s*===\s*0/);
  });

  it('the HR payment routes are behind the session guard', () => {
    expect(payment).toContain("const { requireHR } = require('../../middleware/sessionAuth')");
    expect(payment).toContain("router.get('/hr-all-payments', requireHR,");
    expect(payment).toContain("router.post('/hr-verify', requireHR,");
  });

  it('who approved a payment comes from the session, not the request', () => {
    // The caller used to name themselves in the very header they were
    // authenticated by, so the approval record could say anything.
    expect(payment).toContain('const hrUsername = req.hrUser.username');
    expect(payment).not.toMatch(/hrUsername\s*=\s*auth\.replace/);
  });

  it('promoting a student to coordinator or HR needs a real HR session', () => {
    // isHRAuth guards /hr/promote/to-coordinator, /hr/promote/to-hr and
    // /hr/promotions — anyone could grant themselves a role.
    expect(server).toContain('return !!(session && (session.hr || session.adminUser));');
  });

  it('the payment gateway credit balance is not published to anyone who asks', () => {
    // GET /api/v2/payment/check-credits reported the gateway's remaining credits
    // behind the same broken check, and nothing in the repo ever called it.
    expect(payment).not.toContain("router.get('/check-credits'");
    const callers = fs.readdirSync(path.join(root, 'public'))
      .filter((f) => f.endsWith('.html'))
      .filter((f) => fs.readFileSync(path.join(root, 'public', f), 'utf8').includes('check-credits'));
    expect(callers).toEqual([]);
  });
});
