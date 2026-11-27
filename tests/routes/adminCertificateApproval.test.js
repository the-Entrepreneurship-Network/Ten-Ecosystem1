'use strict';

/**
 * @jest-environment node
 *
 * An admin approves a certificate payment (admin portal → Payments).
 *
 * The approval is what opens the Download on My Certificates
 * (services/certificateEntitlement reads the Payment row). The student is told
 * by email, once, with the link to My Certificates.
 *
 * THE BUG this replaces: approving a certificate called the HR letter
 * generator, which builds LOC/LOR/STAR/offer letters only and threw on every
 * certificate type, silently, inside a catch. And the student got only the
 * generic "payment approved" notice.
 *
 * The real router is mounted with its models stubbed; nothing reaches MongoDB.
 */

const express = require('express');
const request = require('supertest');

const STUDENT = { _id: 'stu1', employeeId: 'TEN/WEB/1001', name: 'Priya Sharma', email: 'priya@example.com', domain: 'Web Development' };

function mount(payment) {
    jest.resetModules();
    const calls = { mails: [], notices: [], generated: 0 };
    const row = { _id: 'pay1', ...payment, async save() { return this; } };

    jest.doMock('../../middleware/adminAuth', () => ({
        requireAdminAPI: (req, res, next) => { req.session = { adminUser: { username: 'tenadmin' } }; next(); },
        verifyAdminCredentials: async () => false,
        ADMIN_USERNAME: 'tenadmin'
    }));
    jest.doMock('../../models/Payment', () => ({ findById: async () => row }));
    jest.doMock('../../models/Student', () => ({ findById: async () => ({ ...STUDENT }) }));
    jest.doMock('../../models/Notification', () => ({ notifyStudent: async (s, n) => { calls.notices.push(n); } }));
    jest.doMock('../../models/AuditLog', () => ({ create: async () => ({}) }));
    jest.doMock('../../utils/mailer', () => ({
        mailerReady: () => true,
        isSendableAddress: (a) => /@/.test(a || ''),
        renderEmail: (o) => JSON.stringify(o),
        createEmailTransporter: () => ({ sendMail: async (m) => { calls.mails.push(m); } }),
        EMAIL_FROM: 'TEN <noreply@example.com>',
        PORTAL_URL: 'https://portal.example'
    }));
    jest.doMock('../../routes/v2/certificates', () => ({ generateAndSaveCert: async () => { calls.generated += 1; } }));

    const app = express();
    app.use(express.json());
    app.use('/', require('../../routes/adminPortal'));
    return { app, row, calls };
}

const certPayment = { orderId: 'CERT-expert-1', studentId: 'stu1', purpose: 'cert_expert', status: 'pending_verification',
    amount: 300, amountRupees: 300, txnUtr: '412345678901', mode: 'manual' };

describe('approving a certificate payment in the admin portal', () => {
    it('approves it, which is what opens the download', async () => {
        const { app, row } = mount(certPayment);
        const r = await request(app).post('/payments/verify/pay1').send({ action: 'approve' });
        expect(r.status).toBe(200);
        expect(row.status).toBe('success');
        expect(row.verifiedBy).toBe('tenadmin');
    });

    it('emails the student once: approved, download it from My Certificates', async () => {
        const { app, calls } = mount(certPayment);
        await request(app).post('/payments/verify/pay1').send({ action: 'approve' });
        expect(calls.mails).toHaveLength(1);
        expect(calls.mails[0].to).toBe('priya@example.com');
        expect(calls.mails[0].subject).toBe('Approved — your Expert Certificate is ready to download');
        const body = JSON.parse(calls.mails[0].html);
        expect(body.cta.url).toBe('https://portal.example/my-certificates.html');
        expect(body.bodyHtml).toContain('₹300');
        // The in-app notice is kept, but does not send a second email.
        expect(calls.notices).toEqual([expect.objectContaining({ email: false, title: 'Certificate payment approved ✓' })]);
    });

    it('THE BUG: no longer runs the HR letter generator, which cannot make certificates', async () => {
        const { app, calls } = mount(certPayment);
        await request(app).post('/payments/verify/pay1').send({ action: 'approve' });
        expect(calls.generated).toBe(0);
    });

    it('a rejection sends no "ready to download" mail', async () => {
        const { app, row, calls } = mount(certPayment);
        await request(app).post('/payments/verify/pay1').send({ action: 'reject', rejectionReason: 'UTR not found in statement' });
        expect(row.status).toBe('failed');
        expect(calls.mails).toHaveLength(0);
    });
});

it('other payments keep their generic approval notice, emailed as before', async () => {
    const { app, calls } = mount({ ...certPayment, purpose: 'fine_low_attendance', amount: 400 });
    await request(app).post('/payments/verify/pay1').send({ action: 'approve' });
    expect(calls.mails).toHaveLength(0);
    expect(calls.notices).toEqual([expect.objectContaining({ title: 'Payment Approved ✓' })]);
    expect(calls.notices[0].email).toBeUndefined();
});
