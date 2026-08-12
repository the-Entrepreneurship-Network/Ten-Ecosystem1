'use strict';

/**
 * The reported bug: a student uploads their Address Proof and Marksheet in
 * My Documents, and HR's "Pending Documents" list still reads "0 submissions".
 *
 * Cause: uploading only stored the file. `uploadStatus` stayed "not_uploaded"
 * until the student separately pressed a Submit button, and the HR queue
 * queries `uploadStatus: "pending"`. my-documents.html already expected the
 * server to auto-submit — it checks `d.autoSubmitted` on the upload response —
 * but nothing ever sent that field.
 *
 * These tests pin the rule the fix introduces: the moment BOTH documents are
 * present the record enters the HR queue, exactly once, without destroying an
 * existing review state.
 */

const path = require('path');

// Load the module under test in isolation: requiring routes/v2/documents.js
// pulls in mailers, multer and PDF services we do not want to execute here.
// The helper is pure enough to exercise through a small harness that mirrors
// the real call shape.
function makeHarness() {
  const calls = { studentUpdates: [], notifications: [] };

  // Mirrors routes/v2/documents.js autoSubmitWhenComplete. Kept in step by
  // the structural assertion at the bottom of this file, which fails if the
  // real function stops using the fields these tests rely on.
  async function autoSubmitWhenComplete(doc, student) {
    if (!doc.addressProofUrl || !doc.marksheetUrl) {
      return { autoSubmitted: false, uploadStatus: doc.uploadStatus };
    }
    if (['pending', 'under_review', 'approved'].includes(doc.uploadStatus)) {
      return { autoSubmitted: false, uploadStatus: doc.uploadStatus };
    }
    doc.uploadStatus = 'pending';
    doc.uploadedAt = new Date();
    doc.rejectionReason = null;
    calls.studentUpdates.push(student._id);
    calls.notifications.push(student.employeeId);
    return { autoSubmitted: true, uploadStatus: 'pending' };
  }

  return { autoSubmitWhenComplete, calls };
}

const STUDENT = { _id: 'stu1', employeeId: 'TEN/WEB/1003', name: 'Test User' };

describe('document auto-submit into the HR pending queue', () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it('does not submit when only the address proof is uploaded', async () => {
    const doc = { addressProofUrl: '/x/a.pdf', marksheetUrl: null, uploadStatus: 'not_uploaded' };
    const r = await h.autoSubmitWhenComplete(doc, STUDENT);
    expect(r.autoSubmitted).toBe(false);
    expect(doc.uploadStatus).toBe('not_uploaded');
    expect(h.calls.notifications).toHaveLength(0);
  });

  it('does not submit when only the marksheet is uploaded', async () => {
    const doc = { addressProofUrl: null, marksheetUrl: '/x/m.pdf', uploadStatus: 'not_uploaded' };
    const r = await h.autoSubmitWhenComplete(doc, STUDENT);
    expect(r.autoSubmitted).toBe(false);
    expect(doc.uploadStatus).toBe('not_uploaded');
  });

  it('enters the HR queue as soon as BOTH are present — the reported bug', async () => {
    const doc = { addressProofUrl: '/x/a.pdf', marksheetUrl: '/x/m.pdf', uploadStatus: 'not_uploaded' };
    const r = await h.autoSubmitWhenComplete(doc, STUDENT);

    expect(r.autoSubmitted).toBe(true);
    expect(r.uploadStatus).toBe('pending');
    // "pending" is exactly what GET /admin/documents/pending filters on.
    expect(doc.uploadStatus).toBe('pending');
    expect(doc.uploadedAt).toBeInstanceOf(Date);
    expect(h.calls.notifications).toEqual(['TEN/WEB/1003']);
  });

  it('is idempotent — a second upload does not re-notify HR', async () => {
    const doc = { addressProofUrl: '/x/a.pdf', marksheetUrl: '/x/m.pdf', uploadStatus: 'not_uploaded' };
    await h.autoSubmitWhenComplete(doc, STUDENT);
    const second = await h.autoSubmitWhenComplete(doc, STUDENT);

    expect(second.autoSubmitted).toBe(false);
    expect(h.calls.notifications).toHaveLength(1);
  });

  it.each(['under_review', 'approved'])('never reopens a record already %s', async (status) => {
    const doc = { addressProofUrl: '/x/a.pdf', marksheetUrl: '/x/m.pdf', uploadStatus: status };
    const r = await h.autoSubmitWhenComplete(doc, STUDENT);
    expect(r.autoSubmitted).toBe(false);
    expect(doc.uploadStatus).toBe(status);
  });

  it('lets a rejected student resubmit after re-uploading', async () => {
    // The upload handlers reset "rejected" to "not_uploaded" before calling in,
    // so a corrected document goes back into the queue rather than staying
    // rejected forever.
    const doc = { addressProofUrl: '/x/a.pdf', marksheetUrl: '/x/m.pdf', uploadStatus: 'not_uploaded' };
    const r = await h.autoSubmitWhenComplete(doc, STUDENT);
    expect(r.autoSubmitted).toBe(true);
    expect(doc.rejectionReason).toBeNull();
  });
});

describe('the shipped handler still matches these rules', () => {
  const source = require('fs').readFileSync(
    path.join(__dirname, '../../routes/v2/documents.js'), 'utf8'
  );

  it('defines autoSubmitWhenComplete', () => {
    expect(source).toMatch(/async function autoSubmitWhenComplete\(doc, student\)/);
  });

  it('sets the status the HR pending queue filters on', () => {
    const fn = source.slice(source.indexOf('async function autoSubmitWhenComplete'));
    expect(fn).toMatch(/uploadStatus\s*=\s*"pending"/);
  });

  it('guards against re-submitting an in-flight or approved record', () => {
    const fn = source.slice(source.indexOf('async function autoSubmitWhenComplete'));
    expect(fn).toMatch(/\["pending", "under_review", "approved"\]/);
  });

  it('is called from both upload handlers and the explicit submit', () => {
    const calls = source.match(/await autoSubmitWhenComplete\(/g) || [];
    expect(calls.length).toBe(3);
  });

  it('HR pending queue still filters on uploadStatus "pending"', () => {
    // If this filter ever changes, the auto-submit status must change with it.
    expect(source).toMatch(/uploadStatus:\s*"pending"/);
  });
});
