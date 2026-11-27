'use strict';

/**
 * @jest-environment node
 *
 * Handing out a course certificate PDF (Expert / Nano Degree / Fellowship).
 *
 *   GET  /api/v2/certificates/course-pdf/:type   the download the page uses
 *   POST /api/v2/certificates/generate-pdf/:type the older "make it" step
 *
 * THE BUGS. Every Download on My Certificates was a 404: the page opened the
 * PDF's file path, and certificate files are private (server.js turns
 * /uploads/certificates away). And generate-pdf checked nothing at all, so any
 * signed-in student could make any tier's PDF without earning it or paying.
 *
 * Both now go through one release check: earned, no deferred Studio fee, and
 * paid (an admin-approved UPI payment, a paid track, or coins).
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const CERT_DIR = path.join(__dirname, '../../uploads/certificates');
const ME = { _id: 'cpdftest0001', employeeId: 'TEN/WEB/77', name: 'Ravi K', domain: 'Web Development', tenure: '1 Month', joiningDate: '2026-10-01' };
const mockState = { student: ME, approved: 4, fee: { covered: false, verifying: false }, made: [] };

function mockQ(result) {
    const p = Promise.resolve(result);
    const obj = { lean: () => obj, select: () => obj, sort: () => obj, then: (a, b) => p.then(a, b), catch: (b) => p.catch(b) };
    return obj;
}

jest.mock('node-cron', () => ({ schedule: () => ({ stop() {}, start() {} }) }));
jest.mock('../../middleware/sessionAuth', () => {
    const pass = (req, res, next) => next();
    return {
        findSessionStudent: async () => mockState.student,
        requireStudent: (req, res, next) => {
            if (!mockState.student) return res.status(401).json({ success: false });
            req.student = mockState.student;
            return next();
        },
        requireHR: pass, requireStaff: pass, requireSelfOrStaff: () => pass
    };
});
jest.mock('../../models/Student', () => ({
    findOne: () => mockQ(mockState.student), find: () => mockQ([{ _id: ME._id }]),
    schema: { path: () => true, add: () => {} }
}));
jest.mock('../../models/new/StudentTaskProgress', () => ({
    countDocuments: async (q) => (q.status === 'approved' ? mockState.approved : 10),
    aggregate: async () => []
}));
jest.mock('../../models/new/CoinRedemption', () => ({ find: () => mockQ([]) }), { virtual: true });
jest.mock('../../models/new/StudentCertificate', () => {
    function StudentCertificate(doc) { Object.assign(this, doc); }
    StudentCertificate.prototype.save = async function save() { return this; };
    StudentCertificate.findOne = async () => null;
    StudentCertificate.find = () => mockQ([]);
    return StudentCertificate;
});
jest.mock('../../models/DocumentHistory', () => ({ logSend: async () => ({}) }));
jest.mock('../../models/MailHistory', () => ({ create: async () => ({}) }));
jest.mock('../../models/Notification', () => ({ create: async () => ({}) }));
jest.mock('../../models/new/PsychologyTrigger', () => ({ find: () => mockQ([]) }));
jest.mock('../../services/studioAccess', () => ({ getStudioAccess: async () => ({ feeDue: null }) }));
jest.mock('../../services/certificateEntitlement', () => ({
    feeSettled: async () => ({ via: mockState.fee.covered ? 'purchase' : null, ...mockState.fee })
}));
jest.mock('../../services/v2/certificateService', () => {
    const write = async (data, outPath) => {
        mockState.made.push(outPath);
        require('fs').writeFileSync(outPath, '%PDF-1.4 test');
        return outPath;
    };
    return {
        generateCertificateId: () => 'TEN-EXP-2026-test01',
        generateExpertCertificate: write, generateNanoCertificate: write, generateFellowshipCertificate: write
    };
});

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/v2', require('../../routes/v2/certificates'));
    return a;
}

const myFile = (type) => path.join(CERT_DIR, `${ME._id}_${type}.pdf`);
function cleanup() { for (const t of ['expert', 'nano_degree', 'fellowship']) fs.rmSync(myFile(t), { force: true }); }

beforeEach(() => {
    Object.assign(mockState, { student: ME, approved: 4, fee: { covered: false, verifying: false }, made: [] });
    cleanup();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

describe('a certificate the student earned but has not paid for', () => {
    it('is not handed out: the answer is the checkout', async () => {
        const r = await request(app()).get('/api/v2/certificates/course-pdf/expert');
        expect(r.status).toBe(402);
        expect(r.body).toMatchObject({ price: 300, checkoutUrl: '/certificate-checkout.html?type=expert' });
        expect(mockState.made).toEqual([]);
    });

    it('THE HOLE: the old generate step no longer makes it for free', async () => {
        const r = await request(app()).post('/api/v2/certificates/generate-pdf/expert');
        expect(r.status).toBe(402);
        expect(mockState.made).toEqual([]);
    });

    it('says "verifying" while HR checks a submitted payment', async () => {
        mockState.fee = { covered: false, verifying: true };
        const r = await request(app()).get('/api/v2/certificates/course-pdf/expert');
        expect(r.status).toBe(402);
        expect(r.body.verifying).toBe(true);
    });
});

describe('a certificate the student has not earned', () => {
    it('is refused even when paid', async () => {
        mockState.fee = { covered: true, verifying: false };
        const r = await request(app()).get('/api/v2/certificates/course-pdf/nano_degree');   // 40% < 70%
        expect(r.status).toBe(403);
        expect(mockState.made).toEqual([]);
    });
});

describe('a certificate earned and paid for', () => {
    it('downloads as a PDF, made on the first download and reused after', async () => {
        mockState.fee = { covered: true, verifying: false };
        const first = await request(app()).get('/api/v2/certificates/course-pdf/expert');
        expect(first.status).toBe(200);
        expect(first.headers['content-type']).toMatch(/application\/pdf/);
        expect(mockState.made).toEqual([myFile('expert')]);

        const again = await request(app()).get('/api/v2/certificates/course-pdf/expert');
        expect(again.status).toBe(200);
        expect(mockState.made).toHaveLength(1);
    });

    it('is linked by the signed-in route, never the private file path', async () => {
        mockState.fee = { covered: true, verifying: false };
        const r = await request(app()).post('/api/v2/certificates/generate-pdf/expert');
        expect(r.status).toBe(200);
        expect(r.body.pdfUrl).toBe('/api/v2/certificates/course-pdf/expert');
    });
});

it('asks a signed-out visitor to sign in', async () => {
    mockState.student = null;
    const r = await request(app()).get('/api/v2/certificates/course-pdf/expert');
    expect(r.status).toBe(401);
});
