const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');

const marketplaceRouter = require('../../routes/v2/marketplace');
const Student = require('../../models/Student');
const CoinRedemption = require('../../models/new/CoinRedemption');

describe('V2 Coin Redemption Marketplace API Unit Tests', () => {
    let app;
    let testStudent;
    let dbConnected = false;

    beforeAll(async () => {
        app = express();
        app.use(express.json());
        app.use('/api/v2/marketplace', marketplaceRouter);

        if (mongoose.connection.readyState === 0) {
            const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/internship_test';
            try {
                // Short timeout so local runs don't hang if MongoDB is not running
                await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
                dbConnected = true;
            } catch (err) {
                console.warn('\n⚠️ MongoDB is not running locally. Skipping database integration tests.');
                return;
            }
        } else {
            dbConnected = true;
        }

        // Create or cleanup test student doc
        try {
            await Student.deleteMany({ employeeId: 'TEN-TEST-MKT-001' });
            await CoinRedemption.deleteMany({ employeeId: 'TEN-TEST-MKT-001' });

            testStudent = await Student.create({
                name: 'Test Intern Marketplace',
                email: 'intern.mkt@example.com',
                employeeId: 'TEN-TEST-MKT-001',
                domain: 'Web Development',
                coins: 500 // Start with 500 coins for testing
            });
        } catch (err) {
            console.error('Failed to set up test data:', err.message);
        }
    });

    afterAll(async () => {
        if (dbConnected) {
            try {
                await Student.deleteMany({ employeeId: 'TEN-TEST-MKT-001' });
                await CoinRedemption.deleteMany({ employeeId: 'TEN-TEST-MKT-001' });
            } catch (err) {}
            if (mongoose.connection.readyState !== 0) {
                await mongoose.connection.close();
            }
        }
    });

    test('1. GET /api/v2/marketplace/catalog returns active coin balance and itemized catalog', async () => {
        if (!dbConnected || !testStudent) return;

        const res = await request(app)
            .get('/api/v2/marketplace/catalog')
            .set('x-employee-id', testStudent.employeeId);

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.studentCoins).toEqual(500);
        expect(res.body.studentCoinValueRupees).toEqual(250); // 500 * 0.50 = ₹250
        expect(res.body.mentorship.length).toBeGreaterThan(0);
        expect(res.body.certificates.length).toBeGreaterThan(0);
    });

    test('2. POST /api/v2/marketplace/quote calculates 40% discount cap correctly for ₹500 session', async () => {
        if (!dbConnected || !testStudent) return;

        const res = await request(app)
            .post('/api/v2/marketplace/quote')
            .set('x-employee-id', testStudent.employeeId)
            .send({ itemKey: 'mentor_500' });

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.retailPrice).toEqual(500);
        expect(res.body.coinsToUse).toEqual(400); // 400 coins max allowed for ₹200 off
        expect(res.body.discountRupees).toEqual(200);
        expect(res.body.netPaidAmount).toEqual(300); // ₹500 - ₹200 = ₹300 net
    });

    test('3. POST /api/v2/marketplace/checkout creates pending escrow hold', async () => {
        if (!dbConnected || !testStudent) return;

        const res = await request(app)
            .post('/api/v2/marketplace/checkout')
            .set('x-employee-id', testStudent.employeeId)
            .send({
                itemKey: 'mentor_250',
                proposedCoins: 200,
                paymentGateway: 'upi_qr'
            });

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.redemptionId).toBeDefined();
        expect(res.body.netPaidAmount).toEqual(150); // ₹250 - ₹100 = ₹150 net
        expect(res.body.businessUpi.upiId).toEqual('paytmqr5k0ods@ptys');
    });

    test('4. POST /api/v2/marketplace/verify-payment debits student coins and completes redemption', async () => {
        if (!dbConnected || !testStudent) return;

        // Create pending redemption
        const checkoutRes = await request(app)
            .post('/api/v2/marketplace/checkout')
            .set('x-employee-id', testStudent.employeeId)
            .send({
                itemKey: 'cert_expert',
                proposedCoins: 100,
                paymentGateway: 'upi_qr'
            });

        const redemptionId = checkoutRes.body.redemptionId;

        const verifyRes = await request(app)
            .post('/api/v2/marketplace/verify-payment')
            .set('x-employee-id', testStudent.employeeId)
            .send({
                redemptionId,
                paymentId: 'PAY_TEST_999'
            });

        expect(verifyRes.statusCode).toEqual(200);
        expect(verifyRes.body.success).toBe(true);
        expect(verifyRes.body.studentCoins).toEqual(400); // 500 - 100 = 400

        // Verify updated student doc in DB
        const updatedStudent = await Student.findOne({ employeeId: testStudent.employeeId });
        expect(updatedStudent.coins).toEqual(400);
    });

    test('5. Anti-Abuse: Enforces single certificate redemption limit per student', async () => {
        if (!dbConnected || !testStudent) return;

        const res = await request(app)
            .post('/api/v2/marketplace/quote')
            .set('x-employee-id', testStudent.employeeId)
            .send({ itemKey: 'cert_expert' });

        expect(res.statusCode).toEqual(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('already redeemed');
    });
});
