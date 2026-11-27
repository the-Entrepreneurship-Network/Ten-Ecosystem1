'use strict';

/**
 * @jest-environment node
 *
 * Paying for a course certificate by UPI: /api/v2/payment/initiate and
 * /api/v2/payment/utr-confirm, as the checkout page uses them.
 *
 * What these protect:
 *   - a student is billed only for a certificate they earned and do not own,
 *     at the configured price (₹300 / ₹500 / ₹1000), never a browser's figure
 *   - the browser cannot rewrite a certificate payment's amount or purpose at
 *     the confirm step, nor turn another order into a certificate
 *   - one UPI reference pays for one thing
 *   - who is paying comes from the session, not a header
 *
 * The real router is mounted with its models stubbed; nothing reaches MongoDB.
 */

const express = require('express');
const request = require('supertest');

const ME = { _id: '64b7f0c2a1b2c3d4e5f60718', employeeId: 'TEN/WEB/1234', name: 'Asha Rao', email: 'asha@example.com' };
const NEEDS_PAYMENT = (type) => ({ code: 402, price: { expert: 300, nano_degree: 500, fellowship: 1000 }[type] });

function mount({ session = ME, block = NEEDS_PAYMENT('expert'), payments = [] } = {}) {
    jest.resetModules();
    const rows = payments.map((p) => ({ ...p }));
    const created = [];
    const withSave = (row) => Object.assign(row, { async save() { return this; } });
    const matches = (q) => (r) => Object.entries(q).every(([k, v]) => {
        if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(r[k]);
        if (v && typeof v === 'object' && '$ne' in v) return r[k] !== v.$ne;
        return r[k] === v;
    });
    const query = (q) => {
        const found = () => { const r = rows.find(matches(q)); return r ? withSave(r) : null; };
        const p = Promise.resolve().then(found);
        p.sort = () => Promise.resolve().then(found);
        p.select = () => ({ lean: async () => found() });
        return p;
    };

    jest.doMock('../../models/Payment', () => ({
        findOne: (q) => query(q),
        create: async (doc) => { const row = withSave({ _id: 'pay' + (rows.length + 1), ...doc }); rows.push(row); created.push(row); return row; }
    }));
    jest.doMock('../../models/Student', () => ({ findOne: async () => null, findById: async () => null }));
    jest.doMock('../../models/Notification', () => function Notification() { this.save = async () => {}; });
    jest.doMock('../../middleware/sessionAuth', () => ({
        findSessionStudent: async () => session,
        requireHR: (req, res, next) => next()
    }));
    jest.doMock('../../utils/mailer', () => ({
        createEmailTransporter: () => ({ sendMail: async () => {} }), EMAIL_FROM: 'x', HR_NOTIFY_EMAIL: 'hr@example.com'
    }));
    jest.doMock('../../routes/v2/certificates', () => ({
        releaseBlock: async () => block,
        getCertificatePrice: (t) => require('../../config/payment').CERT_PRICES[t]
    }));

    const app = express();
    app.use(express.json());
    app.use('/api/v2/payment', require('../../routes/v2/payment'));
    return { app, rows, created };
}

describe('starting a certificate payment', () => {
    it('bills the configured price and hands back a QR for exactly that amount', async () => {
        const { app, created } = mount();
        const r = await request(app).post('/api/v2/payment/initiate').send({ purpose: 'cert_expert', amount: 1 });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true, amount: 300, upiId: 'paytmqr5k0ods@ptys', payeeName: 'Limitless Technologies' });
        expect(r.body.qrUrl).toBe('/api/upi-qr?amount=300&note=' + encodeURIComponent('Expert Certificate TEN/WEB/1234'));
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ purpose: 'cert_expert', amount: 300, status: 'pending',
            studentId: ME._id, employeeId: 'TEN/WEB/1234' });
    });

    it.each([['cert_nano_degree', 'nano_degree', 500], ['cert_fellowship', 'fellowship', 1000]])(
        '%s costs ₹%s', async (purpose, type, amount) => {
            const { app } = mount({ block: NEEDS_PAYMENT(type) });
            const r = await request(app).post('/api/v2/payment/initiate').send({ purpose });
            expect(r.body.amount).toBe(amount);
        });

    it('coming back to the checkout resumes the open order instead of making a second', async () => {
        const { app, created } = mount({ payments: [{ orderId: 'CERT-OLD', studentId: ME._id, purpose: 'cert_expert', status: 'pending', amount: 300 }] });
        const r = await request(app).post('/api/v2/payment/initiate').send({ purpose: 'cert_expert' });
        expect(r.body.orderId).toBe('CERT-OLD');
        expect(created).toHaveLength(0);
    });

    it('refuses a certificate the student has not earned', async () => {
        const { app, created } = mount({ block: { code: 403, message: 'You have not unlocked this certificate yet.' } });
        const r = await request(app).post('/api/v2/payment/initiate').send({ purpose: 'cert_fellowship' });
        expect(r.status).toBe(403);
        expect(created).toHaveLength(0);
    });

    it('does not bill for a certificate the student already owns', async () => {
        const { app, created } = mount({ block: null });
        const r = await request(app).post('/api/v2/payment/initiate').send({ purpose: 'cert_expert' });
        expect(r.status).toBe(400);
        expect(r.body.owned).toBe(true);
        expect(created).toHaveLength(0);
    });

    it('does not bill twice while a payment is being verified', async () => {
        const { app, created } = mount({ block: { code: 402, verifying: true, message: 'verifying' } });
        const r = await request(app).post('/api/v2/payment/initiate').send({ purpose: 'cert_expert' });
        expect(r.status).toBe(402);
        expect(r.body.verifying).toBe(true);
        expect(created).toHaveLength(0);
    });

    it('acts for nobody when signed out, whatever header is sent', async () => {
        const { app, created } = mount({ session: null });
        const r = await request(app).post('/api/v2/payment/initiate')
            .set('x-employee-id', 'TEN/WEB/9999').send({ purpose: 'cert_expert', employeeId: 'TEN/WEB/9999' });
        expect(r.status).toBe(401);
        expect(created).toHaveLength(0);
    });
});

describe('confirming a certificate payment with its UPI reference', () => {
    const open = () => ({ orderId: 'CERT-1', studentId: ME._id, purpose: 'cert_fellowship', status: 'pending', amount: 1000 });

    it('records the reference and leaves the price and purpose as the server set them', async () => {
        const { app, rows } = mount({ payments: [open()] });
        const r = await request(app).post('/api/v2/payment/utr-confirm')
            .send({ orderId: 'CERT-1', utr: '4123 4567 8901', amount: 1, description: 'Direct UPI Payment' });
        expect(r.status).toBe(200);
        expect(rows[0]).toMatchObject({ status: 'pending_verification', txnUtr: '412345678901', amount: 1000, purpose: 'cert_fellowship' });
    });

    it('wants the 12-digit UPI reference for a certificate', async () => {
        const { app, rows } = mount({ payments: [open()] });
        const r = await request(app).post('/api/v2/payment/utr-confirm').send({ orderId: 'CERT-1', utr: '123456' });
        expect(r.status).toBe(400);
        expect(rows[0].status).toBe('pending');
    });

    it('will not take a reference that already paid for something', async () => {
        const used = { orderId: 'X-1', studentId: 'someone', purpose: 'cert_expert', status: 'success', txnUtr: '412345678901', amount: 300 };
        const { app, rows } = mount({ payments: [used, open()] });
        const r = await request(app).post('/api/v2/payment/utr-confirm').send({ orderId: 'CERT-1', utr: '412345678901' });
        expect(r.status).toBe(409);
        expect(rows[1].status).toBe('pending');
    });

    it('will not rename another order into a certificate', async () => {
        const generic = { orderId: 'PAY-1', studentId: ME._id, purpose: 'Direct UPI Payment', status: 'pending', amount: 1 };
        const { app, rows } = mount({ payments: [generic] });
        await request(app).post('/api/v2/payment/utr-confirm').send({ orderId: 'PAY-1', utr: '412345678901', description: 'cert_fellowship' });
        expect(rows[0].purpose).toBe('Direct UPI Payment');
    });

    it('will not open a certificate payment without an order', async () => {
        const { app, created } = mount();
        const r = await request(app).post('/api/v2/payment/utr-confirm')
            .send({ utr: '412345678901', amount: 1, description: 'cert_expert' });
        expect(r.status).toBe(400);
        expect(created).toHaveLength(0);
    });
});
