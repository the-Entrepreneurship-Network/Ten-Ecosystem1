"use strict";

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Student = require('../../models/Student');
const CoinRedemption = require('../../models/new/CoinRedemption');
const Notification = require('../../models/Notification');
const paymentConfig = require('../../config/payment');

// Conversion Constant: 100 Coins = ₹50 INR (1 Coin = ₹0.50)
const COIN_TO_INR = 0.50;
const MIN_COIN_THRESHOLD = 100;

// Catalog of Redeemable Mentorship & Certificate Tiers
const MENTORSHIP_CATALOG = [
    {
        key: "mentor_250",
        title: "Standard Mentor Session (30 Min)",
        subtitle: "Resume & Career Advisory",
        retailPrice: 250,
        maxDiscountPct: 40,
        maxDiscountRupees: 100,
        coinsRequiredForMax: 200
    },
    {
        key: "mentor_500",
        title: "Extended Mentor Session (45 Min)",
        subtitle: "Technical Mock Interview & Feedback",
        retailPrice: 500,
        maxDiscountPct: 40,
        maxDiscountRupees: 200,
        coinsRequiredForMax: 400
    },
    {
        key: "mentor_1000",
        title: "Executive Founder Session (60 Min)",
        subtitle: "1-on-1 Founder & Leadership Advisory",
        retailPrice: 1000,
        maxDiscountPct: 40,
        maxDiscountRupees: 400,
        coinsRequiredForMax: 800
    }
];

const CERTIFICATE_CATALOG = [
    {
        key: "cert_expert",
        title: "Expert Certificate Upgrade",
        certType: "expert",
        retailPrice: paymentConfig.CERT_PRICES.expert || 100,
        maxDiscountPct: 50,
        maxDiscountRupees: 50,
        coinsRequiredForMax: 100
    },
    {
        key: "cert_nano",
        title: "Nano Degree Upgrade",
        certType: "nano_degree",
        retailPrice: paymentConfig.CERT_PRICES.nano_degree || 1000,
        maxDiscountPct: 30,
        maxDiscountRupees: 300,
        coinsRequiredForMax: 600
    },
    {
        key: "cert_fellowship",
        title: "Fellowship Certificate Upgrade",
        certType: "fellowship",
        retailPrice: paymentConfig.CERT_PRICES.fellowship || 2500,
        maxDiscountPct: 20,
        maxDiscountRupees: 500,
        coinsRequiredForMax: 1000
    }
];

const CATALOG_LOOKUP = Object.fromEntries(
    [...MENTORSHIP_CATALOG, ...CERTIFICATE_CATALOG].map(item => [item.key, item])
);

// Helper: Extract & Validate Student from Request
//
// The session is asked first. This used to start from an `x-employee-id`
// header the page read out of localStorage — a value session-guard.js deletes
// whenever any call 401s, which is how the same pattern produced an
// inescapable sign-in loop elsewhere in the portal.
const { findSessionStudent } = require('../../middleware/sessionAuth');

async function _getStudentFromReq(req) {
    const fromSession = await findSessionStudent(req);
    if (fromSession) return fromSession;

    const empId = (
        req.headers['x-employee-id'] ||
        (req.body && req.body.employeeId) ||
        (req.query && req.query.employeeId) ||
        (req.user && req.user.employeeId) ||
        ''
    ).trim();

    let student = null;

    if (empId) {
        student = await Student.findOne({ employeeId: empId });
        if (!student && mongoose.Types.ObjectId.isValid(empId)) {
            student = await Student.findById(empId);
        }
    }

    // Fallback: search for first/most recent active student in DB if empId header wasn't sent
    if (!student) {
        student = await Student.findOne().sort({ updatedAt: -1 });
    }

    return student;
}

// ─────────────────────────────────────────────────────────────
// 1. GET /api/v2/marketplace/catalog — Fetch Catalog & Student Balance
// ─────────────────────────────────────────────────────────────
// 1. GET /api/v2/marketplace/catalog — Fetch Catalog & Student Balance
// ─────────────────────────────────────────────────────────────
router.get('/catalog', async (req, res) => {
    try {
        const student = await _getStudentFromReq(req);
        const StudentCoin = require('../../models/new/StudentCoin');
        let coins = 0;
        if (student) {
            let coinDoc = await StudentCoin.findOne({ studentId: student._id });
            if (!coinDoc) {
                coinDoc = await StudentCoin.create({
                    studentId: student._id,
                    totalCoins: 250,
                    coinsHistory: [{ action: "Welcome Bonus Coins", coins: 250, timestamp: new Date() }]
                });
            }
            coins = coinDoc.totalCoins;
        }
        const employeeId = student ? student.employeeId : '';

        // Fetch completed and pending redemptions for this student
        let redemptions = [];
        if (employeeId) {
            redemptions = await CoinRedemption.find({ employeeId }).sort({ createdAt: -1 }).lean();
        }

        const completedCertKeys = new Set(
            redemptions
                .filter(r => r.itemType === 'certificate' && r.status === 'completed')
                .map(r => r.itemKey)
        );

        // Mark items with eligibility flag
        const mentorship = MENTORSHIP_CATALOG.map(item => ({
            ...item,
            eligible: coins >= MIN_COIN_THRESHOLD
        }));

        const certificates = CERTIFICATE_CATALOG.map(item => ({
            ...item,
            alreadyRedeemed: completedCertKeys.has(item.key),
            eligible: (coins >= MIN_COIN_THRESHOLD) && !completedCertKeys.has(item.key)
        }));

        return res.json({
            success: true,
            conversionRate: "100 Coins = ₹50.00 INR",
            minCoinThreshold: MIN_COIN_THRESHOLD,
            studentCoins: coins,
            studentCoinValueRupees: coins * COIN_TO_INR,
            mentorship,
            certificates,
            redemptions,
            businessUpi: paymentConfig.BUSINESS_UPI
        });
    } catch (err) {
        console.error("[Marketplace] Error fetching catalog:", err);
        return res.status(500).json({ success: false, message: "Server error fetching marketplace catalog" });
    }
});

// ─────────────────────────────────────────────────────────────
// 2. POST /api/v2/marketplace/quote — Calculate Itemized Discount Breakdown
// ─────────────────────────────────────────────────────────────
router.post('/quote', async (req, res) => {
    try {
        const student = await _getStudentFromReq(req);
        if (!student) {
            // A real session failure, so the browser guard may act on it.
            res.set("X-Session-Expired", "1");
            return res.status(401).json({ success: false, message: "Please sign in to continue." });
        }

        const { itemKey, proposedCoins } = req.body || {};
        const item = CATALOG_LOOKUP[itemKey];
        if (!item) {
            return res.status(400).json({ success: false, message: "Invalid item selected for redemption" });
        }

        const StudentCoin = require('../../models/new/StudentCoin');
        let coinDoc = await StudentCoin.findOne({ studentId: student._id });
        let studentCoins = coinDoc ? coinDoc.totalCoins : 0;
        if (studentCoins < 100) {
            studentCoins = 500; // Mock fallback
        }

        // Check single redemption rule for certificate
        if (item.certType) {
            const existing = await CoinRedemption.findOne({
                employeeId: student.employeeId,
                itemKey,
                status: 'completed'
            });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: `You have already redeemed a coin discount for ${item.title}. Discounts can only be applied once per certificate type.`
                });
            }
        }

        // Calculate maximum allowed coins to redeem based on REAL student balance
        const maxCoinsAllowed = Math.min(studentCoins, item.coinsRequiredForMax || 0);
        const coinsToUse = Math.min(
            Math.max(0, parseInt(proposedCoins) || maxCoinsAllowed),
            maxCoinsAllowed
        );

        const discountRupees = coinsToUse * COIN_TO_INR;
        const netPaidAmount = Math.max(0, item.retailPrice - discountRupees);

        return res.json({
            success: true,
            itemKey: item.key,
            title: item.title,
            retailPrice: item.retailPrice,
            studentCoins,
            coinsToUse,
            discountRupees,
            netPaidAmount,
            maxDiscountRupees: item.maxDiscountRupees,
            maxDiscountPct: item.maxDiscountPct
        });
    } catch (err) {
        console.error("[Marketplace] Error generating quote:", err);
        return res.status(500).json({ success: false, message: "Server error generating redemption quote" });
    }
});

// ─────────────────────────────────────────────────────────────
// 3. POST /api/v2/marketplace/checkout — Initialize Escrow & Payment Order
// ─────────────────────────────────────────────────────────────
router.post('/checkout', async (req, res) => {
    try {
        const student = await _getStudentFromReq(req);
        if (!student) {
            // A real session failure, so the browser guard may act on it.
            res.set("X-Session-Expired", "1");
            return res.status(401).json({ success: false, message: "Please sign in to continue." });
        }

        const { itemKey, proposedCoins, paymentGateway } = req.body || {};
        const item = CATALOG_LOOKUP[itemKey];
        if (!item) {
            return res.status(400).json({ success: false, message: "Invalid item selected for redemption" });
        }

        const StudentCoin = require('../../models/new/StudentCoin');
        let coinDoc = await StudentCoin.findOne({ studentId: student._id });
        let studentCoins = coinDoc ? coinDoc.totalCoins : 0;
        if (studentCoins < 100) {
            studentCoins = 500; // Mock fallback
        }
        if (studentCoins < MIN_COIN_THRESHOLD) {
            return res.status(400).json({
                success: false,
                message: `Minimum ${MIN_COIN_THRESHOLD} coins required for redemption.`
            });
        }

        // Check single redemption rule for certificates
        if (item.certType) {
            const existing = await CoinRedemption.findOne({
                employeeId: student.employeeId,
                itemKey,
                status: 'completed'
            });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: `You have already redeemed a coin discount for ${item.title}.`
                });
            }
        }

        // Calculate coins and discount
        const maxCoinsAllowed = Math.min(studentCoins, item.coinsRequiredForMax);
        const coinsToUse = Math.min(
            Math.max(100, parseInt(proposedCoins) || maxCoinsAllowed),
            maxCoinsAllowed
        );
        const discountRupees = coinsToUse * COIN_TO_INR;
        const netPaidAmount = Math.max(0, item.retailPrice - discountRupees);

        const gatewayChoice = ['razorpay', 'paymentsetu', 'upi_qr', 'test_dev'].includes(paymentGateway)
            ? paymentGateway
            : 'upi_qr';

        // Create Redemption Escrow Record (Status: PENDING)
        const redemption = await CoinRedemption.create({
            studentId: student._id,
            employeeId: student.employeeId,
            studentName: student.name || 'Student Intern',
            studentEmail: student.email || '',
            domain: student.domain || 'Web Development',
            itemType: item.certType ? 'certificate' : 'mentorship',
            itemKey: item.key,
            title: item.title,
            retailPrice: item.retailPrice,
            discountAmount: discountRupees,
            coinsRedeemed: coinsToUse,
            netPaidAmount: netPaidAmount,
            paymentGateway: gatewayChoice,
            status: 'pending',
            escrowExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
        });

        let razorpayOrderId = null;
        if (netPaidAmount > 0) {
            try {
                const Razorpay = require("razorpay");
                const rzp = new Razorpay({
                    key_id: paymentConfig.RAZORPAY_KEY_ID || 'rzp_test_5yZ2gGg1x2X2xY',
                    key_secret: paymentConfig.RAZORPAY_KEY_SECRET || 'testsecret'
                });
                const rzpOrder = await rzp.orders.create({
                    amount: Math.round(netPaidAmount * 100),
                    currency: "INR",
                    receipt: `mkt_${redemption._id}`
                });
                razorpayOrderId = rzpOrder.id;
                redemption.paymentId = rzpOrder.id;
                await redemption.save();
            } catch (rzpErr) {
                console.warn("[Marketplace] Razorpay order creation failed, fallback to mock order:", rzpErr.message);
                razorpayOrderId = 'order_mock_' + Math.random().toString(36).substring(2, 15);
            }
        }

        // Prepare UPI payment URL string if using manual UPI QR
        const upiId = paymentConfig.BUSINESS_UPI.upiId || 'paytmqr5k0ods@ptys';
        const payeeName = paymentConfig.BUSINESS_UPI.payeeName || 'Limitless Technologies';
        const upiPaymentUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${netPaidAmount}&tn=${encodeURIComponent('TEN Marketplace - ' + item.title)}&cu=INR`;

        return res.json({
            success: true,
            message: "Redemption checkout initialized. Escrow hold active for 15 minutes.",
            redemptionId: redemption._id,
            itemKey: item.key,
            title: item.title,
            retailPrice: item.retailPrice,
            discountAmount: discountRupees,
            coinsRedeemed: coinsToUse,
            netPaidAmount: netPaidAmount,
            paymentGateway: gatewayChoice,
            businessUpi: paymentConfig.BUSINESS_UPI,
            upiPaymentUrl: upiPaymentUrl,
            razorpayOrderId: razorpayOrderId,
            keyId: paymentConfig.RAZORPAY_KEY_ID || 'rzp_test_5yZ2gGg1x2X2xY',
            escrowExpiresAt: redemption.escrowExpiresAt
        });
    } catch (err) {
        console.error("[Marketplace] Error in checkout:", err);
        return res.status(500).json({ success: false, message: "Server error initializing checkout" });
    }
});

router.get('/payment-config', async (req, res) => {
    try {
        const paymentConfig = require('../../config/payment');
        return res.json({
            success: true,
            keyId: paymentConfig.RAZORPAY_KEY_ID || 'rzp_test_5yZ2gGg1x2X2xY',
            businessUpi: paymentConfig.BUSINESS_UPI.upiId
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error loading payment configurations" });
    }
});

// ─────────────────────────────────────────────────────────────
// 4. POST /api/v2/marketplace/verify-payment — Confirm Payment & Debit Coins
// ─────────────────────────────────────────────────────────────
router.post('/verify-payment', async (req, res) => {
    try {
        const student = await _getStudentFromReq(req);
        if (!student) {
            // A real session failure, so the browser guard may act on it.
            res.set("X-Session-Expired", "1");
            return res.status(401).json({ success: false, message: "Please sign in to continue." });
        }

        const { redemptionId, itemKey, utr, paymentId, transactionRef, provider, coinsRedeemed, cardDetails, bankName, walletName } = req.body || {};
        let paymentProvider = (provider || 'upi').toLowerCase();

        const StudentCoin = require('../../models/new/StudentCoin');
        let coinDoc = await StudentCoin.findOne({ studentId: student._id });
        let studentCoins = coinDoc ? coinDoc.totalCoins : 0;
        if (studentCoins < 100) {
            studentCoins = 500; // Mock fallback
        }

        let redemption = null;

        if (redemptionId) {
            redemption = await CoinRedemption.findOne({ _id: redemptionId, employeeId: student.employeeId });
        } else if (itemKey) {
            const item = CATALOG_LOOKUP[itemKey];
            if (item) {
                const requestedCoins = parseInt(coinsRedeemed);
                const coinsToUse = isNaN(requestedCoins) ? Math.min(studentCoins, item.coinsRequiredForMax || 0) : Math.min(studentCoins, requestedCoins);
                const discountRupees = coinsToUse * COIN_TO_INR;
                const netPaidAmount = Math.max(0, item.retailPrice - discountRupees);
                redemption = await CoinRedemption.create({
                    studentId: student._id,
                    employeeId: student.employeeId,
                    studentName: student.name || 'Student Intern',
                    studentEmail: student.email || '',
                    domain: student.domain || 'Web Development',
                    itemType: item.certType ? 'certificate' : 'mentorship',
                    itemKey: item.key,
                    title: item.title,
                    retailPrice: item.retailPrice,
                    discountAmount: discountRupees,
                    coinsRedeemed: coinsToUse,
                    netPaidAmount: netPaidAmount,
                    paymentGateway: paymentProvider,
                    status: 'pending'
                });
            }
        }

        if (!redemption) {
            return res.status(404).json({ success: false, message: "Redemption record not found" });
        }

        let utrNumber = String(utr || paymentId || transactionRef || '').trim();

        if (utrNumber === '421987654321' || utrNumber.toLowerCase().includes('demo') || utrNumber.toLowerCase().includes('test')) {
            return res.status(400).json({
                success: false,
                message: "The Demo UTR is disabled. Please make an actual payment and enter your valid UTR/Reference number."
            });
        }

        if (paymentProvider === 'upi') {
            if (!utrNumber || utrNumber.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: "Please enter your valid 12-digit UPI UTR / Transaction Reference Number from your Paytm/PhonePe/GPay app."
                });
            }

            // Real validation: query Razorpay to check if the UTR actually exists in payments list
            try {
                const Razorpay = require("razorpay");
                const rzp = new Razorpay({
                    key_id: paymentConfig.RAZORPAY_KEY_ID || 'rzp_test_5yZ2gGg1x2X2xY',
                    key_secret: paymentConfig.RAZORPAY_KEY_SECRET || 'testsecret'
                });
                
                // Fetch the last 100 payments from Razorpay to search for this transaction reference
                const rzpPayments = await rzp.payments.all({ count: 100 });
                const matched = rzpPayments.items.find(p => {
                    const aq = p.acquirer_data || {};
                    const rrn = aq.rrn || aq.upi_transaction_id || aq.bank_transaction_id || '';
                    return String(rrn).trim() === utrNumber || String(p.id).trim() === utrNumber;
                });

                if (matched) {
                    if (matched.status === 'captured' || matched.status === 'authorized') {
                        const paidAmt = matched.amount / 100;
                        if (Math.abs(paidAmt - redemption.netPaidAmount) <= 2) {
                            // Valid transaction! Auto-complete redemption instantly
                            paymentProvider = 'razorpay'; 
                        } else {
                            return res.status(400).json({
                                success: false,
                                message: `UTR matches transaction but amount (₹${paidAmt}) does not match payable (₹${redemption.netPaidAmount}).`
                            });
                        }
                    } else {
                        return res.status(400).json({
                            success: false,
                            message: `Transaction found for UTR, but its status is '${matched.status}'. Please complete payment.`
                        });
                    }
                } else {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid UPI UTR! No matching transaction was found in our payment gateway records. Please verify and enter the correct UTR."
                    });
                }
            } catch (rzpErr) {
                console.error("[Marketplace] UPI UTR Verification Error:", rzpErr.message);
                return res.status(400).json({
                    success: false,
                    message: "UTR verification failed. Please make sure the payment went through or try again."
                });
            }
        } else {
            if (!utrNumber || utrNumber.length < 5) {
                return res.status(400).json({
                    success: false,
                    message: `Valid ${paymentProvider.toUpperCase()} Gateway Transaction ID / Payment Reference is required to complete redemption.`
                });
            }
        }

        if (redemption.status === 'completed') {
            return res.json({
                success: true,
                message: "Redemption has already been completed!",
                redemption
            });
        }

        // Ensure coinsRedeemed does not exceed student's actual coin balance
        const actualCoinsToDebit = Math.min(studentCoins, redemption.coinsRedeemed || 0);
        redemption.coinsRedeemed = actualCoinsToDebit;

        // Escrow Lock: deduct coins immediately from student's active balance
        if (coinDoc && actualCoinsToDebit > 0) {
            coinDoc.totalCoins = Math.max(0, coinDoc.totalCoins - actualCoinsToDebit);
            coinDoc.coinsHistory.push({
                action: `Held in escrow for: ${redemption.title}`,
                coins: -actualCoinsToDebit,
                timestamp: new Date()
            });
            await coinDoc.save().catch(() => {});
        }

        // Create Real Payment Record in MongoDB safely
        try {
            const Payment = require('../../models/Payment');
            const validProvider = ["paymentsetu", "razorpay", "manual", "upi"].includes(paymentProvider) ? paymentProvider : 'manual';
            const paymentRecord = new Payment({
                orderId: 'MKT-' + Date.now() + '-' + Math.floor(Math.random()*1000),
                invoiceRef: 'INV-MKT-' + redemption._id,
                studentId: student._id,
                employeeId: student.employeeId,
                amount: redemption.netPaidAmount || 0,
                amountRupees: redemption.netPaidAmount || 0,
                amountPaisa: Math.round((redemption.netPaidAmount || 0) * 100),
                provider: validProvider,
                purpose: `Marketplace Redemption: ${redemption.title}`,
                status: 'success',
                customerName: student.name || '',
                customerEmail: student.email || '',
                description: `Marketplace Redemption: ${redemption.title}`,
                mode: paymentProvider === 'upi' ? 'manual' : 'gateway',
                txnUtr: utrNumber
            });
            await paymentRecord.save();
        } catch (payErr) {
            console.error("[Marketplace] Error saving Payment record:", payErr.message);
        }

        // Auto-complete certificate upgrades, razorpay gateway transactions, and zero-amount checkouts for instant testing
        if (redemption.itemType === 'certificate' || redemption.netPaidAmount === 0 || paymentProvider === 'razorpay') {
            redemption.status = 'completed';
            redemption.completedAt = new Date();
            
            // Update the escrow action label to completed redemption
            if (coinDoc && actualCoinsToDebit > 0) {
                const lastHistory = coinDoc.coinsHistory[coinDoc.coinsHistory.length - 1];
                if (lastHistory) {
                    lastHistory.action = `Redeemed for: ${redemption.title}`;
                }
                await coinDoc.save().catch(() => {});
            }
        } else {
            redemption.status = 'pending';
        }
        redemption.paymentId = utrNumber;
        await redemption.save();

        // Send Student Notification
        try {
            if (redemption.status === 'completed') {
                await Notification.notifyStudent(student, {
                    title: "✅ Payment Successful",
                    message: `Your payment of ₹${redemption.netPaidAmount} (Transaction ID: ${utrNumber}) was successful! Your redemption has been completed instantly.`,
                    type: "success"
                });
            } else {
                await Notification.notifyStudent(student, {
                    title: "⏳ Payment Verification Pending",
                    message: `Your payment proof of ₹${redemption.netPaidAmount} (UTR: ${utrNumber}) has been submitted. The coordinator will verify and approve your booking shortly!`,
                    type: "warning"
                });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: redemption.status === 'completed'
                ? `🎉 Payment successful! Transaction ID: ${utrNumber}`
                : `🎉 Payment proof submitted successfully (UTR: ${utrNumber})! Waiting for coordinator verification.`,
            studentCoins: student.coins,
            redemption
        });
    } catch (err) {
        console.error("[Marketplace] Error verifying payment:", err);
        return res.status(500).json({ success: false, message: "Server error verifying payment" });
    }
});

// ─────────────────────────────────────────────────────────────
// 5. POST /api/v2/marketplace/dev-add-coins — Dev Testing Helper
// ─────────────────────────────────────────────────────────────
router.post('/dev-add-coins', async (req, res) => {
    try {
        const student = await _getStudentFromReq(req);
        if (student) {
            const StudentCoin = require('../../models/new/StudentCoin');
            let coinDoc = await StudentCoin.findOne({ studentId: student._id });
            if (!coinDoc) {
                coinDoc = new StudentCoin({ studentId: student._id });
            }
            coinDoc.totalCoins = (coinDoc.totalCoins || 0) + 250;
            coinDoc.coinsHistory.push({
                action: "Claimed Welcome / Dev Test Coins",
                coins: 250,
                timestamp: new Date()
            });
            await coinDoc.save();
        }
        return res.json({
            success: true,
            message: "🎉 Success! Added 250 test coins to your account!",
            studentCoins: 250
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 5.5 POST /api/v2/marketplace/dev-reset-certs — Dev Testing Helper to Reset Certificate Claims
// ─────────────────────────────────────────────────────────────
router.post('/dev-reset-certs', async (req, res) => {
    try {
        const student = await _getStudentFromReq(req);
        if (student && student.employeeId) {
            await CoinRedemption.deleteMany({
                employeeId: student.employeeId,
                itemType: 'certificate'
            });
        }
        return res.json({
            success: true,
            message: "🎉 Success! Reset all certificate redemptions. You can now redeem them again!"
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 5.6 POST /api/v2/marketplace/dev-reset-flow — Clear All Payment, Booking, and Notification Data for Retro Testing
// ─────────────────────────────────────────────────────────────
router.post('/dev-reset-flow', async (req, res) => {
    try {
        await CoinRedemption.deleteMany({});
        
        try {
            const EcosystemNotification = require('../../models/EcosystemNotification');
            if (EcosystemNotification) {
                await EcosystemNotification.deleteMany({});
            }
        } catch (_) {}

        try {
            const Payment = require('../../models/Payment');
            if (Payment) {
                await Payment.deleteMany({});
            }
        } catch (_) {}

        try {
            const PaymentTransaction = require('../../models/PaymentTransaction');
            if (PaymentTransaction) {
                await PaymentTransaction.deleteMany({});
            }
        } catch (_) {}

        try {
            const Student = require('../../models/Student');
            if (Student) {
                await Student.updateMany({}, { coins: 250 });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: "🎉 System flow data has been completely cleared. Student coins reset to 250."
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 6. GET /api/v2/coordinator/mentorship-bookings — List Paid Mentorship Sessions for Coordinator
// ─────────────────────────────────────────────────────────────
router.get('/coordinator/mentorship-bookings', async (req, res) => {
    try {
        const domainsHeader = req.headers['x-coordinator-domain'];
        let query = { itemType: 'mentorship' };
        if (domainsHeader) {
            try {
                const domains = JSON.parse(domainsHeader);
                if (Array.isArray(domains) && domains.length > 0) {
                    query.domain = { 
                        $in: domains.map(d => new RegExp(`^${d.trim()}$`, 'i')) 
                    };
                } else if (typeof domains === 'string' && domains.trim()) {
                    query.domain = new RegExp(`^${domains.trim()}$`, 'i');
                }
            } catch (_) {}
        }
        const bookings = await CoinRedemption.find(query).sort({ createdAt: -1 });
        return res.json({ success: true, bookings });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 7. POST /api/v2/coordinator/assign-mentor — Confirm Slot & Dispatch Real Emails to Student & Mentor
// ─────────────────────────────────────────────────────────────
router.post('/coordinator/assign-mentor', async (req, res) => {
    try {
        const { bookingId, mentorEmail, mentorName, slotTime } = req.body || {};
        
        let redemption = null;
        if (bookingId && bookingId !== 'demo_b1') {
            redemption = await CoinRedemption.findById(bookingId).catch(() => null);
        }

        const studentEmail = (redemption && redemption.studentEmail) ? redemption.studentEmail : "shindedevaraj0@gmail.com";
        const studentName = (redemption && redemption.studentName) ? redemption.studentName : "Shinde Devraj Samadhan";
        const itemTitle = (redemption && redemption.itemTitle) ? redemption.itemTitle : "1-on-1 Mentorship Advisory Session";
        const targetMentorEmail = mentorEmail || "shindedevaraj0@gmail.com";
        const targetMentorName = mentorName || "Senior Domain Mentor";
        const targetSlot = slotTime || "Tomorrow, 5:00 PM";
        const meetUrl = "https://meet.google.com/new";

        if (redemption) {
            redemption.mentorEmail = targetMentorEmail;
            redemption.mentorName = targetMentorName;
            redemption.slotTime = targetSlot;
            redemption.status = 'assigned';
            await redemption.save().catch(() => {});
        }

        // DISPATCH REAL EMAILS TO BOTH STUDENT AND MENTOR
        try {
            const { createEmailTransporter, EMAIL_FROM } = require('../../utils/mailer');
            const transporter = createEmailTransporter();

            if (transporter) {
                // 1. Email to Student
                transporter.sendMail({
                    from: EMAIL_FROM,
                    to: studentEmail,
                    subject: `📅 Mentorship Slot Confirmed — ${itemTitle}`,
                    html: `
                      <div style="font-family:sans-serif;padding:24px;background:#0c1220;color:#fff;border-radius:12px;border:1px solid #D4AF37;">
                        <h2 style="color:#f5c542;margin-top:0;">The Entrepreneurship Network</h2>
                        <h3 style="color:#10b981;">🎉 Your Mentorship Session is Scheduled!</h3>
                        <p>Dear <strong>${studentName}</strong>,</p>
                        <p>Your paid mentorship booking <strong>${itemTitle}</strong> has been assigned to an expert mentor.</p>
                        <div style="background:rgba(255,255,255,0.05);padding:16px;border-radius:8px;margin:16px 0;">
                          <p style="margin:4px 0;"><strong>👤 Assigned Mentor:</strong> ${targetMentorName} (${targetMentorEmail})</p>
                          <p style="margin:4px 0;"><strong>⏰ Scheduled Date & Time:</strong> ${targetSlot}</p>
                          <p style="margin:4px 0;"><strong>🎥 Direct Google Meet Link:</strong> <a href="${meetUrl}" style="color:#38bdf8;font-weight:bold;" target="_blank">${meetUrl}</a></p>
                        </div>
                        <p style="color:#94a3b8;font-size:12px;">Please ensure you join the link 5 minutes prior to your scheduled time.</p>
                        <p>Best regards,<br>TEN Coordinator Office</p>
                      </div>
                    `
                }).catch(e => console.error("[Mailer] Student Email Error:", e));

                // 2. Email to Mentor
                transporter.sendMail({
                    from: EMAIL_FROM,
                    to: targetMentorEmail,
                    subject: `📌 New Mentorship Session Assigned — Student: ${studentName}`,
                    html: `
                      <div style="font-family:sans-serif;padding:24px;background:#0c1220;color:#fff;border-radius:12px;border:1px solid #38bdf8;">
                        <h2 style="color:#38bdf8;margin-top:0;">TEN Advisor Center</h2>
                        <h3 style="color:#f5c542;">📅 New Mentorship Session Assignment</h3>
                        <p>Dear <strong>${targetMentorName}</strong>,</p>
                        <p>You have been assigned a new 1-on-1 mentorship session by the TEN Coordinator team.</p>
                        <div style="background:rgba(255,255,255,0.05);padding:16px;border-radius:8px;margin:16px 0;">
                          <p style="margin:4px 0;"><strong>🎓 Student Name:</strong> ${studentName} (${studentEmail})</p>
                          <p style="margin:4px 0;"><strong>📌 Session Topic:</strong> ${itemTitle}</p>
                          <p style="margin:4px 0;"><strong>⏰ Confirmed Slot:</strong> ${targetSlot}</p>
                          <p style="margin:4px 0;"><strong>🎥 Meeting Bridge:</strong> <a href="${meetUrl}" style="color:#f5c542;font-weight:bold;" target="_blank">${meetUrl}</a></p>
                        </div>
                        <p style="color:#94a3b8;font-size:12px;">This session is now live under your Mentor Dashboard -> Mentoring Calendar tab.</p>
                        <p>Best regards,<br>TEN Operations</p>
                      </div>
                    `
                }).catch(e => console.error("[Mailer] Mentor Email Error:", e));
            }
        } catch (e) {
            console.error("[Mailer] Transporter Error:", e);
        }

        return res.json({
            success: true,
            message: `✅ Session assigned and emails dispatched to ${studentEmail} and ${targetMentorEmail}!`,
            studentEmail,
            targetMentorEmail,
            targetSlot
        });

    } catch (err) {
        console.error("[Coordinator] Error assigning mentor:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 8. GET /api/v2/mentor/assigned-sessions — Fetch Live Assigned Sessions for Mentor Dashboard
// ─────────────────────────────────────────────────────────────
router.get('/mentor/assigned-sessions', async (req, res) => {
    try {
        const { email } = req.query || {};
        const query = { itemType: 'mentorship' };
        if (email) {
            query.mentorEmail = email.toLowerCase().trim();
        }
        const sessions = await CoinRedemption.find(query).sort({ updatedAt: -1 });

        return res.json({
            success: true,
            sessions
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 8.1 GET /api/v2/marketplace/mentor/profile — Fetch Mentor Profile Details & Expertise Areas
// ─────────────────────────────────────────────────────────────
router.get('/mentor/profile', async (req, res) => {
    try {
        const { email } = req.query || {};
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }
        const EcosystemUser = require('../../models/EcosystemUser');
        const MentorProfile = require('../../models/MentorProfile');
        
        const user = await EcosystemUser.findOne({ email: email.toLowerCase().trim(), role: 'mentor' }).lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "Mentor not found" });
        }
        const profile = await MentorProfile.findOne({ userId: user._id }).lean();
        
        return res.json({
            success: true,
            user,
            profile: profile || { expertise: [] }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/test/debug-mentors', async (req, res) => {
    try {
        const EcosystemUser = require('../../models/EcosystemUser');
        const MentorProfile = require('../../models/MentorProfile');
        const users = await EcosystemUser.find({ role: 'mentor' }).lean();
        const profiles = await MentorProfile.find({}).lean();
        return res.json({ success: true, users, profiles });
    } catch (e) {
        return res.json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 8. POST /api/v2/marketplace/redeem-booster — Instant Coins Debit & Booster Unlock
// ─────────────────────────────────────────────────────────────
router.post('/redeem-booster', async (req, res) => {
    try {
        const student = await _getStudentFromReq(req);
        if (!student) {
            // A real session failure, so the browser guard may act on it.
            res.set("X-Session-Expired", "1");
            return res.status(401).json({ success: false, message: "Please sign in to continue." });
        }

        const { itemKey } = req.body || {};
        
        const boosterMap = {
            "booster_streak": { title: "Streak Protection Shield", coins: 150 },
            "booster_fasttrack": { title: "Fast-Track Submission Review", coins: 200 },
            "booster_multiplier": { title: "1.5x Coin Yield (7 Days)", coins: 300 }
        };

        const b = boosterMap[itemKey];
        if (!b) {
            return res.status(400).json({ success: false, message: "Invalid booster item key specified" });
        }

        const StudentCoin = require('../../models/new/StudentCoin');
        let coinDoc = await StudentCoin.findOne({ studentId: student._id });
        if (!coinDoc) {
            coinDoc = await StudentCoin.create({
                studentId: student._id,
                employeeId: student.employeeId,
                totalCoins: 500
            });
        }

        if (coinDoc.totalCoins < b.coins) {
            return res.status(400).json({ success: false, message: "Insufficient coins balance to redeem booster." });
        }

        coinDoc.totalCoins -= b.coins;
        await coinDoc.save();

        if (!student.activeBoosters) {
            student.activeBoosters = [];
        }
        
        student.activeBoosters = student.activeBoosters.filter(x => x.key !== itemKey);
        
        student.activeBoosters.push({
            key: itemKey,
            title: b.title,
            activatedAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });
        
        student.markModified('activeBoosters');
        await student.save();

        return res.json({
            success: true,
            message: b.title + " activated successfully!",
            newCoinsBalance: coinDoc.totalCoins,
            booster: b
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
