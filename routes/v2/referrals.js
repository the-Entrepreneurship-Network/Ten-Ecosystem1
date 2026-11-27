'use strict';

/**
 * Refer & Earn, for the signed-in student. The rules live in
 * services/referrals.js; public/refer.html is the page.
 *
 *   GET  /api/v2/referrals/me                the page's data (settles first)
 *   GET  /api/v2/referrals/qr.png            a QR code of the student's link
 *   POST /api/v2/referrals/ambassador/apply  { college }
 */

const express = require('express');
const QRCode = require('qrcode');
const { requireStudent } = require('../../middleware/sessionAuth');
const referrals = require('../../services/referrals');

const router = express.Router();

function fail(res, err, what) {
    if (err instanceof referrals.ReferralError) {
        return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    }
    console.error(`[referrals] ${what} failed:`, err && err.message);
    return res.status(500).json({ success: false, message: 'Refer & Earn could not load just now. Try again in a minute.' });
}

router.get('/me', requireStudent, async (req, res) => {
    try {
        res.json({ success: true, ...(await referrals.summarize(req.student)) });
    } catch (err) {
        fail(res, err, 'summary');
    }
});

router.get('/qr.png', requireStudent, async (req, res) => {
    try {
        const code = await referrals.ensureCode(req.student);
        const png = await QRCode.toBuffer(referrals.linkFor(code), { type: 'png', width: 480, margin: 2 });
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'private, max-age=3600');
        if (req.query.download) res.set('Content-Disposition', 'attachment; filename="ten-refer-qr.png"');
        res.end(png);
    } catch (err) {
        fail(res, err, 'qr');
    }
});

router.post('/ambassador/apply', requireStudent, async (req, res) => {
    try {
        const out = await referrals.applyAmbassador(req.student, { college: req.body && req.body.college });
        res.json({ success: true, ...out });
    } catch (err) {
        fail(res, err, 'ambassador application');
    }
});

module.exports = router;
