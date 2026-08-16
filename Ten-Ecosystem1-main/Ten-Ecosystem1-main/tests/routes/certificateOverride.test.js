'use strict';

/**
 * HR issuing a certificate directly, and the record that keeps it honest.
 *
 * A large number of interns finished their internship over WhatsApp. They
 * registered on the portal only to collect the certificate they had already
 * earned, so there is no application, attendance reads 0% and the task journey
 * is untouched — every check the portal runs refuses them, and every refusal is
 * correct about the data and wrong about the student.
 *
 * The bypass is therefore deliberate. What must not be optional is:
 *
 *   · HR sees exactly what is missing, once, before issuing
 *   · the issue is recorded with the numbers as they were AT THE TIME
 *   · an admin can see every one of them, and take one back
 *   · the certificate actually reaches the student's My Documents
 *
 * That last one is its own bug and has its own describe block: the endpoint
 * both pages read returned one of two shapes depending on a branch that, after
 * identity moved to the session, could no longer be reached by a student — so
 * the document table read `data.locStatus` off an object that never had it.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const certRoutes = fs.readFileSync(path.join(root, 'routes/v2/certificates.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'routes/adminPortal.js'), 'utf8');
const hrPage = fs.readFileSync(path.join(root, 'public/hr-portal.html'), 'utf8');
const adminPage = fs.readFileSync(path.join(root, 'public/ten-admin.html'), 'utf8');
const docsPage = fs.readFileSync(path.join(root, 'public/my-documents.html'), 'utf8');

describe('the override record', () => {
  const Override = require('../../models/CertificateOverride');

  it('keeps the measured values as they were when it was issued', () => {
    // Attendance and performance both move. "Issued at 41% attendance" has to
    // stay true in the record after the number changes underneath it.
    const p = Override.schema.paths;
    ['snapshot.attendancePercentage', 'snapshot.performanceScore',
     'snapshot.taskCompletionPct', 'snapshot.hadApplication'].forEach((f) => {
      expect(p[f]).toBeDefined();
    });
  });

  it('records whether the student actually met the bar', () => {
    expect(Override.schema.paths.metRequirements).toBeDefined();
    expect(Override.schema.paths.failedChecks).toBeDefined();
  });

  it('names the issuer, and can be revoked', () => {
    ['issuedBy', 'issuedByRole', 'revokedAt', 'revokedBy', 'revokeReason'].forEach((f) => {
      expect(Override.schema.paths[f]).toBeDefined();
    });
  });

  it('refuses a certificate type that is not one', () => {
    const doc = new Override({ employeeId: 'TEN/WEB/1', certificateType: 'GOLD_STAR' });
    const err = doc.validateSync();
    expect(err && err.errors.certificateType).toBeDefined();
  });

  it('accepts each real one', () => {
    ['LOC', 'LOR', 'STAR', 'OFFER', 'LOP'].forEach((t) => {
      const doc = new Override({ employeeId: 'TEN/WEB/1', certificateType: t });
      const err = doc.validateSync();
      expect(err && err.errors && err.errors.certificateType).toBeUndefined();
    });
  });
});

describe('the student record carries the flag', () => {
  const Student = require('../../models/Student');

  it('marks which documents were issued directly by HR', () => {
    // Without this the row says "Issued" with no account of where it came from.
    ['locIssuedByOverride', 'lorIssuedByOverride', 'starIssuedByOverride',
     'offerIssuedByOverride', 'lopIssuedByOverride'].forEach((f) => {
      expect(Student.schema.paths[f]).toBeDefined();
      expect(Student.schema.paths[f].instance).toBe('Boolean');
    });
  });
});

describe('the HR endpoints', () => {
  it('are behind a staff session, not open to anyone', () => {
    expect(certRoutes).toMatch(/router\.get\("\/hr-issue\/precheck", requireStaff/);
    expect(certRoutes).toMatch(/router\.post\("\/hr-issue", requireStaff/);
  });

  it('take the issuer from the session, never from the body', () => {
    // An issuer read from the request would let the audit trail name anyone.
    const at = certRoutes.indexOf('function issuerFrom(');
    expect(at).toBeGreaterThan(-1);
    const fn = certRoutes.slice(at, certRoutes.indexOf('\n}', at));
    expect(fn).toContain('session');
    expect(fn).not.toContain('req.body');
    expect(certRoutes).toContain('const issuer = issuerFrom(req.session);');
  });

  it('answer 409 when the student falls short and nobody has confirmed', () => {
    // 409 rather than 400: the request is well formed, it is unconfirmed. The
    // portal turns exactly this into the one warning popup.
    const at = certRoutes.indexOf('router.post("/hr-issue"');
    const block = certRoutes.slice(at, at + 3200);
    expect(block).toContain('if (!metRequirements && !acknowledged)');
    expect(block).toContain('res.status(409)');
    expect(block).toContain('requiresConfirmation: true');
    expect(block).toContain('failedChecks: failed');
  });

  it('generate the certificate without consulting eligibility first', () => {
    // The whole point. describeShortfall() runs to DESCRIBE, and its answer
    // gates nothing except the confirmation.
    const at = certRoutes.indexOf('router.post("/hr-issue"');
    const block = certRoutes.slice(at, at + 3200);
    const gen = block.indexOf('generateAndSaveCert');
    const confirm = block.indexOf('requiresConfirmation');
    expect(gen).toBeGreaterThan(confirm);
    // No attendance/performance threshold stands between the two.
    expect(block.slice(confirm, gen)).not.toMatch(/attendancePercentage\s*[<>]/);
    expect(block.slice(confirm, gen)).not.toMatch(/>=\s*75/);
  });

  it('write an override row for every issue, met or not', () => {
    const at = certRoutes.indexOf('router.post("/hr-issue"');
    const block = certRoutes.slice(at, at + 3200);
    expect(block).toContain('CertificateOverride.create');
    // Not inside an `if (!metRequirements)` — an issue that met the bar is
    // still an issue that bypassed the application queue.
    const create = block.indexOf('CertificateOverride.create');
    const guard = block.lastIndexOf('if (', create);
    expect(block.slice(guard, create)).not.toMatch(/!metRequirements[\s\S]*\{\s*$/);
  });

  it('set the student flag so the portal can say who issued it', () => {
    const at = certRoutes.indexOf('router.post("/hr-issue"');
    const block = certRoutes.slice(at, at + 3200);
    expect(block).toContain('OVERRIDE_FIELDS[type].flag');
  });
});

describe('the one warning', () => {
  it('is shown only when the student has not met the requirements', () => {
    // A student who earned it does not need a scary dialog to receive it.
    expect(hrPage).toContain('async function directIssueConfirm(employeeId, certType, meets)');
    const at = hrPage.indexOf('async function directIssueConfirm(');
    const fn = hrPage.slice(at, at + 1800);
    expect(fn).toContain('if(!meets){');
    expect(fn).toContain('Swal.fire');
    expect(fn).toContain('bypasses every check');
  });

  it('lists what is missing rather than saying "not eligible"', () => {
    expect(hrPage).toContain('(d.failedChecks||[])');
    expect(hrPage).toContain('has not met the requirements');
  });

  it('sends acknowledged: true only after the confirmation', () => {
    const at = hrPage.indexOf('async function directIssueConfirm(');
    const fn = hrPage.slice(at, at + 2600);
    const cancel = fn.indexOf('if(!ok.isConfirmed) return;');
    const post = fn.indexOf("acknowledged: true");
    expect(cancel).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(cancel);
  });

  it('escapes what it renders from the server', () => {
    expect(hrPage).toContain('function _diEsc(');
    expect(hrPage).toContain('_diEsc(d.studentName');
  });
});

describe('the admin section', () => {
  it('exists, behind the admin session', () => {
    expect(adminRoutes).toMatch(/router\.get\('\/certificate-overrides', requireAdminAPI/);
    expect(adminRoutes).toMatch(/router\.post\('\/certificate-overrides\/:id\/revoke', requireAdminAPI/);
  });

  it('defaults to the issues that matter', () => {
    // Everything HR ever issued is a long list. The ones where the student did
    // not meet the bar are the reason the list exists.
    expect(adminRoutes).toContain("if (filter === 'unmet') q.metRequirements = false;");
    expect(adminPage).toContain("let overrideFilter = 'unmet';");
  });

  it('revoking actually removes the certificate, not just the row', () => {
    // A revocation that leaves the PDF downloadable is theatre.
    const at = adminRoutes.indexOf("router.post('/certificate-overrides/:id/revoke'");
    const block = adminRoutes.slice(at, at + 2600);
    expect(block).toContain('[f.pdf]: null');
    expect(block).toContain('[f.status]: f.reset');
    expect(block).toContain('[f.flag]: false');
  });

  it('writes an audit log entry with both sides', () => {
    const at = adminRoutes.indexOf("router.post('/certificate-overrides/:id/revoke'");
    const block = adminRoutes.slice(at, at + 3000);
    expect(block).toContain('oldState');
    expect(block).toContain('newState');
  });

  it('has a navigation entry and a badge in the portal', () => {
    expect(adminPage).toContain("showSection('cert-overrides')");
    expect(adminPage).toContain('id="section-cert-overrides"');
    expect(adminPage).toContain("if (name === 'cert-overrides') loadOverrides(overrideFilter);");
    expect(adminPage).toContain('id="overrideBadge"');
  });

  it('escapes the student and HR names it prints', () => {
    expect(adminPage).toContain('function ovEsc(');
    expect(adminPage).toContain('ovEsc(o.studentName');
    expect(adminPage).toContain('ovEsc(o.issuedBy');
  });
});

describe('the certificate reaches My Documents', () => {
  it('serves both payload shapes from one response', () => {
    // The bug: `employeeId` was only honoured for staff, so a student always
    // took the first branch and got expert/nano/fellowship — while
    // my-documents.html read locStatus, lorStatus and hasLocPdf off it and
    // rendered every row as "Not Available".
    const at = certRoutes.indexOf('async function handleMyCerts(');
    const fn = certRoutes.slice(at, certRoutes.indexOf('\n}\n', at));

    ['payload.expert', 'payload.nano_degree', 'payload.fellowship'].forEach((k) => {
      expect(fn).toContain(k);
    });
    ['payload.locStatus', 'payload.lorStatus', 'payload.starStatus',
     'payload.offerLetterStatus', 'payload.hasLocPdf', 'payload.hasOfferPdf'].forEach((k) => {
      expect(fn).toContain(k);
    });
  });

  it('no longer branches on whether an employeeId was passed', () => {
    const at = certRoutes.indexOf('async function handleMyCerts(');
    const fn = certRoutes.slice(at, certRoutes.indexOf('\n}\n', at));
    expect(fn).not.toContain('if (!employeeId && headerEmployeeId)');
    expect(fn).toContain('const targetId = isStaff ? requestedId : sessionEmployeeId;');
  });

  it('still never sends the base64 PDFs to the browser', () => {
    const at = certRoutes.indexOf('async function handleMyCerts(');
    const fn = certRoutes.slice(at, certRoutes.indexOf('\n}\n', at));
    expect(fn).toContain('payload.hasLocPdf   = !!doc.locPdfBase64;');
    expect(fn).not.toMatch(/payload\.locPdfBase64\s*=/);
    expect(fn).not.toMatch(/payload\.password/);
  });

  it('tells the student who issued it', () => {
    const at = certRoutes.indexOf('async function handleMyCerts(');
    const fn = certRoutes.slice(at, certRoutes.indexOf('\n}\n', at));
    expect(fn).toContain('payload.hrIssued');
    expect(docsPage).toContain('HR_ISSUED');
    expect(docsPage).toContain('Issued directly by HR');
  });

  it('offers the download whenever a PDF exists', () => {
    // Requiring the status field to ALSO read issued/approved meant a
    // certificate generated by HR could sit in the database with the row
    // still saying "Not yet issued".
    expect(docsPage).toContain('if (hasPdf) {');
    expect(docsPage).not.toContain("if (hasPdf && ['issued','approved'].includes(status))");
  });
});
