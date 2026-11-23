'use strict';

/**
 * What the help desk tells a verified student about their own account. Each
 * state of a payment, a document upload and a letter has to come out as a
 * true, finished sentence.
 */

function load({ student = {}, doc = null, payments = [], total = 0, approved = 0 } = {}) {
    jest.resetModules();
    const Student = { findOne: jest.fn(async (q) => (typeof q.email === 'string' ? (q.email === 'asha@gmail.com' ? student : null) : student)) };
    jest.doMock('../../models/Student', () => Student);
    jest.doMock('../../models/new/StudentDocument', () => ({ findOne: jest.fn(async () => doc) }));
    jest.doMock('../../models/new/StudentTaskProgress', () => ({
        countDocuments: jest.fn(async (q) => (q.status === 'approved' ? approved : total))
    }));
    jest.doMock('../../models/Payment', () => ({ find: () => ({ sort: () => ({ limit: async () => payments }) }) }));
    return Object.assign({ Student }, require('../../services/supportDesk/facts'));
}

const RECENT = new Date('2026-11-01T00:00:00Z'); // after the 9 July fee cut-off
const fastTrack = { _id: 's1', name: 'asha rao', employeeId: 'TEN/WEB/1005', tenure: '1 Month', createdAt: RECENT };

test('a fast-track student who has not paid is told how, and the amount', async () => {
    const { valuesFor } = load({ student: fastTrack });
    const v = await valuesFor(fastTrack);
    expect(v.firstName).toBe('Asha');
    expect(v.plan).toBe('1 Month (fast-track, ₹1000)');
    expect(v.feeStatus).toMatch(/fee of ₹1000, and we have not received a payment yet/);
    expect(v.feeStatus).toContain('Submit UTR for HR Approval');
});

test('a submitted UTR is acknowledged with its number; an approved fee says so', async () => {
    let ctx = load({ payments: [{ status: 'pending_verification', providerPaymentId: 'UTR123456', createdAt: RECENT }] });
    expect((await ctx.valuesFor(fastTrack)).feeStatus).toMatch(/^We received your UPI transaction ID UTR123456 on 1 November 2026/);
    ctx = load({ payments: [{ status: 'success' }] });
    expect((await ctx.valuesFor(fastTrack)).feeStatus).toMatch(/has been approved/);
    ctx = load({ payments: [{ status: 'failed', rejectionReason: 'UTR not found' }] });
    expect((await ctx.valuesFor(fastTrack)).feeStatus).toMatch(/not approved, because: UTR not found/);
});

test('free plans, and students who joined before the fee, owe nothing', async () => {
    const { valuesFor } = load();
    expect((await valuesFor({ _id: 's2', tenure: '3 Months', createdAt: RECENT })).feeStatus).toBe('Your plan has no fee to pay.');
    expect((await valuesFor({ _id: 's3', tenure: '1 Week', createdAt: new Date('2026-06-01') })).plan).toBe('1 Week (free)');
});

test('documents: missing, half there, under review, rejected with the reason', async () => {
    let v = await load().valuesFor(fastTrack);
    expect(v.documentsStatus).toMatch(/^We have not received your documents yet/);
    v = await load({ doc: { addressProofUrl: '/x.pdf', uploadStatus: 'not_uploaded' } }).valuesFor(fastTrack);
    expect(v.documentsStatus).toBe('We have your address proof but not your marksheet yet. Upload it under My Documents → Upload Documents.');
    v = await load({ doc: { uploadStatus: 'pending', uploadedAt: RECENT } }).valuesFor(fastTrack);
    expect(v.documentsStatus).toBe('We received your documents on 1 November 2026, and HR is reviewing them.');
    expect(v.offerLetterStatus).toMatch(/as soon as HR approves your documents/);
    v = await load({ doc: { uploadStatus: 'rejected', rejectionReason: 'Marksheet is blurred' } }).valuesFor(fastTrack);
    expect(v.documentsStatus).toMatch(/not accepted, because: Marksheet is blurred/);
});

test('letters already issued are reported as issued, with the date', async () => {
    const doc = { uploadStatus: 'approved', offerLetterSentAt: RECENT, offerLetterUrl: '/u/x.pdf', locUrl: '/u/l.pdf', locSentAt: RECENT };
    const v = await load({ doc, total: 12, approved: 12 }).valuesFor(fastTrack);
    expect(v.offerLetterStatus).toMatch(/^Your offer letter was issued on 1 November 2026/);
    expect(v.completionStatus).toMatch(/^Your Letter of Completion has been issued on 1 November 2026/);
});

test('progress towards the Letter of Completion, or nothing when there are no tasks yet', async () => {
    let v = await load({ total: 12, approved: 5 }).valuesFor(fastTrack);
    expect(v.tasksStatus).toBe('So far, 5 of your 12 weekly tasks in the Task Journey are approved.');
    expect(v.completionStatus).toMatch(/^You have 5 of 12 weekly tasks approved/);
    v = await load().valuesFor(fastTrack);
    expect(v.tasksStatus).toBe('');
    expect(v.completionStatus).toBe('');
});

test('an older account stored with capitals is still found', async () => {
    const { findStudent, Student } = load({ student: { _id: 'old' } });
    expect(await findStudent('Old.Student@Gmail.com')).toEqual({ _id: 'old' });
    expect(Student.findOne.mock.calls[1][0].email).toBeInstanceOf(RegExp);
});
