"use strict";

const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const https        = require('https');
const Payment      = require('../../models/Payment');
const Student      = require('../../models/Student');
const Notification = require('../../models/Notification');

// Read dynamically per-request so env var changes take effect without restart
function getApiKey()  { return process.env.PAYMENTSETU_API_KEY || ''; }
function getSiteUrl() {
  if (process.env.BASE_URL)          return process.env.BASE_URL.replace(/\/$/, '');
  if (process.env.REPLIT_DEV_DOMAIN) return 'https://' + process.env.REPLIT_DEV_DOMAIN;
  return 'https://virtualinternships.entrepreneurshipnetwork.net';
}

// PaymentSetu HTTP helper — sends both X-API-Key and Authorization Bearer
function callPaymentSetuAPI(path, method, body) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) return reject(new Error('PAYMENTSETU_API_KEY is not configured'));

    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'paymentsetu.com',
      path:     '/api' + path,
      method:   method || 'GET',
      headers: {
        'X-API-Key':     apiKey,
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

function sanitizeMobile(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return last10.length === 10 ? last10 : '';
}

// POST /api/v2/payment/create-order
router.post('/create-order', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
    }

    const student = await Student.findOne({ employeeId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const amount = parseFloat(req.body.amount);
    if (!amount || amount < 1) return res.status(400).json({ success: false, message: 'Invalid amount (minimum ₹1)' });

    const payMethod = req.body.method || (req.body.directUpi ? 'upi' : 'gateway');
    if (payMethod === 'upi') {
      const invoiceRef  = req.body.invoiceRef  || ('INV-' + employeeId + '-' + Date.now());
      const description = req.body.description || '';
      const orderId     = 'PAY-' + employeeId + '-' + Date.now();
      const mobile      = sanitizeMobile(student.phone || student.mobile || '');
      
      const paymentProvider = require('../../services/v2/paymentProvider');
      const upiPaymentData = await paymentProvider.generateManualUpiPayment({
        amount: amount,
        orderId: orderId,
        purpose: description || 'Direct UPI Payment'
      });

      const payment = new Payment({
        orderId,
        invoiceRef,
        studentId:      student._id,
        employeeId,
        amount:         amount,
        provider:       'upi',
        purpose:        description || 'Direct UPI Payment',
        amountRupees:   amount,
        amountPaisa:    Math.round(amount * 100),
        status:         'pending',
        paymentUrl:     '',
        customerName:   student.name   || '',
        customerEmail:  student.email  || '',
        customerMobile: mobile,
        description,
        mode:           'manual'
      });
      await payment.save();

      return res.json({
        success: true,
        orderId,
        mode: 'manual',
        upiId: upiPaymentData.upiId,
        payeeName: upiPaymentData.payeeName,
        qrCodeDataUrl: upiPaymentData.qrCodeDataUrl,
        instructions: upiPaymentData.instructions
      });
    }

    const invoiceRef  = req.body.invoiceRef  || ('INV-' + employeeId + '-' + Date.now());
    const description = req.body.description || '';
    const amountPaisa = Math.round(amount * 100);
    const orderId     = 'PAY-' + employeeId + '-' + Date.now();
    const redirectUrl = getSiteUrl() + '/payment-return.html?orderId=' + orderId;
    const mobile      = sanitizeMobile(student.phone || student.mobile || '');

    console.log('[PAYMENT] Creating order for', employeeId, '| amount:', amount, '| redirect:', redirectUrl);

    let apiRes;
    try {
      apiRes = await callPaymentSetuAPI('/create_order', 'POST', {
        order_id:        orderId,
        amount:          String(amountPaisa),
        redirect_url:    redirectUrl,
        customer_name:   student.name   || '',
        customer_email:  student.email  || '',
        customer_mobile: mobile
      });
    } catch (netErr) {
      console.error('[PAYMENT] Network error calling PaymentSetu:', netErr.message);
      return res.status(502).json({ success: false, message: 'Payment gateway unreachable. Please try again.' });
    }

    const apiBody = apiRes.body;
    console.log('[PAYMENT] PaymentSetu response (HTTP ' + apiRes.status + '):', JSON.stringify(apiBody));

    if (apiBody && apiBody.status === true && apiBody.payment_url) {
      const payment = new Payment({
        orderId,
        invoiceRef,
        studentId:      student._id,
        employeeId,
        amount:         amount,
        provider:       'paymentsetu',
        purpose:        description || 'Internship Payment',
        amountRupees:   amount,
        amountPaisa,
        status:         'pending',
        paymentUrl:     apiBody.payment_url,
        customerName:   student.name   || '',
        customerEmail:  student.email  || '',
        customerMobile: mobile,
        description
      });
      await payment.save();
      return res.json({ success: true, paymentUrl: apiBody.payment_url, orderId });
    }

    if (apiBody && apiBody.error_code === 'ALREADY_PAID') {
      const existing = await Payment.findOne({ orderId, status: 'success' });
      if (existing) return res.json({ success: true, alreadyPaid: true, orderId: existing.orderId, txnUtr: existing.txnUtr });
      return res.status(409).json({ success: false, message: 'This order was already paid.' });
    }
    if (apiBody && apiBody.error_code === 'CREDIT_EXHAUSTED') {
      return res.status(503).json({ success: false, message: 'Payment credits exhausted. Please contact support.' });
    }

    const msgLower = (apiBody && (apiBody.msg || apiBody.message || '')).toLowerCase();
    if (msgLower.includes('token') || msgLower.includes('api key') || msgLower.includes('auth')) {
      console.error('[PAYMENT] API key rejected by PaymentSetu:', apiBody);
      return res.status(502).json({ success: false, message: 'Payment gateway authentication failed. Please contact support.' });
    }

    console.error('[PAYMENT] Unexpected API response:', apiBody);
    return res.status(502).json({ success: false, message: 'Payment gateway returned an unexpected response. Please try again.' });

  } catch (err) {
    console.error('[PAYMENT] create-order error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// POST /api/v2/payment/webhook
router.post('/webhook',
  express.raw({ type: '*/*' }),
  async (req, res) => {
    const rawBody   = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const signature = req.headers['x-paymentsetu-signature'] || '';
    const timestamp = req.headers['x-paymentsetu-timestamp'] || '';

    if (signature && timestamp) {
      const apiKey   = getApiKey();
      const expected = crypto.createHmac('sha256', apiKey).update(timestamp + '.' + rawBody).digest('hex');
      try {
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
          console.warn('[PAYMENT WEBHOOK] Invalid signature');
          return res.status(401).send('Invalid signature');
        }
      } catch (_) {
        console.warn('[PAYMENT WEBHOOK] Signature comparison failed');
        return res.status(401).send('Invalid signature');
      }
    }

    let data;
    try { data = JSON.parse(rawBody); } catch (e) {
      console.error('[PAYMENT WEBHOOK] Invalid JSON body');
      return res.status(200).send('OK');
    }

    const { order_id, status, txn_utr, txn_time, customer_upi_id } = data;
    console.log('[PAYMENT WEBHOOK] order_id:', order_id, '| status:', status, '| utr:', txn_utr);

    if (status !== 'success') return res.status(200).send('OK - not success');

    try {
      const payment = await Payment.findOne({ orderId: order_id });
      if (!payment) {
        console.warn('[PAYMENT WEBHOOK] No payment record for orderId:', order_id);
        return res.status(200).send('OK - not found');
      }
      if (payment.status === 'success') {
        console.log('[PAYMENT WEBHOOK] Already processed, skipping');
        return res.status(200).send('OK - duplicate');
      }

      payment.status         = 'success';
      payment.txnUtr         = txn_utr;
      payment.txnTime        = txn_time;
      payment.customerUpiId  = customer_upi_id;
      payment.webhookPayload = data;
      payment.updatedAt      = new Date();
      await payment.save();

      try {
        await new Notification({
          title:            '💳 Payment Successful!',
          message:          `Payment of ₹${payment.amountRupees} confirmed. UTR: ${txn_utr}`,
          type:             'success',
          from:             'System',
          targetType:       'student',
          targetEmployeeId: payment.employeeId
        }).save();
      } catch (_) {}

      console.log('[PAYMENT WEBHOOK] Marked success for orderId:', order_id);
    } catch (err) {
      console.error('[PAYMENT WEBHOOK] DB error:', err.message);
    }
    return res.status(200).send('OK');
  }
);

// GET /api/v2/payment/status/:orderId
router.get('/status/:orderId', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const payment = await Payment.findOne({ orderId: req.params.orderId });
    if (!payment)                         return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.employeeId !== employeeId) return res.status(403).json({ success: false, message: 'Forbidden' });

    if (payment.status === 'pending') {
      try {
        console.log('[PAYMENT STATUS CHECK] Actively checking with PaymentSetu for orderId:', payment.orderId);
        const apiRes = await callPaymentSetuAPI('/check_status?order_id=' + payment.orderId, 'GET', null);
        console.log('[PAYMENT STATUS CHECK] PaymentSetu response:', apiRes ? apiRes.body : 'No response');
        if (apiRes && apiRes.body) {
          const body = apiRes.body;
          const isSuccess = 
            (body.status === 'success') || 
            (body.data && body.data.status === 'success') || 
            (body.order && body.order.status === 'success') ||
            (body.status === true && body.data && body.data.status === 'success');
            
          if (isSuccess) {
            const utr = (body.data && body.data.txn_utr) || body.txn_utr || 'API_POLL_' + Date.now();
            const txnTime = (body.data && body.data.txn_time) || body.txn_time || new Date().toISOString();
            const upiId = (body.data && body.data.customer_upi_id) || body.customer_upi_id || '';
            
            payment.status = 'success';
            payment.txnUtr = utr;
            payment.txnTime = txnTime;
            payment.customerUpiId = upiId;
            await payment.save();
            console.log('[PAYMENT STATUS CHECK] Payment updated to success via active polling!');

            try {
              await new Notification({
                title:            '💳 Payment Successful!',
                message:          `Payment of ₹${payment.amountRupees} confirmed. UTR: ${payment.txnUtr}`,
                type:             'success',
                from:             'System',
                targetType:       'student',
                targetEmployeeId: payment.employeeId
              }).save();
            } catch (_) {}
          }
        }
      } catch (checkErr) {
        console.error('[PAYMENT STATUS CHECK] Active verification failed:', checkErr.message);
      }
    }

    return res.json({
      success:      true,
      status:       payment.status,
      amountRupees: payment.amountRupees,
      txnUtr:       payment.txnUtr,
      txnTime:      payment.txnTime,
      createdAt:    payment.createdAt
    });
  } catch (err) {
    console.error('[PAYMENT] status error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Helper for robust student authentication
async function getAuthenticatedStudent(req) {
  if (req.session?.student?._id) {
    return await Student.findById(req.session.student._id);
  }
  const employeeId = req.headers['x-employee-id'] || req.body.employeeId || req.query.employeeId;
  if (!employeeId) return null;
  return await Student.findOne({ employeeId: String(employeeId) });
}

// GET /api/v2/payment/my-obligations
router.get('/my-obligations', async (req, res) => {
  try {
    const student = await getAuthenticatedStudent(req);
    if (!student) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const paymentConfig = require('../../config/payment');
    const { isInternshipComplete } = require('../../utils/internshipStatus');

    const certFees = [];

    // Expert Certificate
    if (student.locStatus && student.locStatus !== 'not_eligible') {
      const successPay = await Payment.findOne({ studentId: student._id, purpose: 'cert_expert', status: 'success' });
      if (!successPay) {
        const pendingVerify = await Payment.findOne({ studentId: student._id, purpose: 'cert_expert', status: 'pending_verification' });
        certFees.push({
          purpose: "cert_expert",
          label: "Expert Certificate",
          amount: paymentConfig.CERT_PRICES.expert || 100,
          status: pendingVerify ? "pending_verification" : "unpaid"
        });
      }
    }

    // Nano Degree Certificate
    if (student.lorStatus && student.lorStatus !== 'not_eligible') {
      const successPay = await Payment.findOne({ studentId: student._id, purpose: 'cert_nano_degree', status: 'success' });
      if (!successPay) {
        const pendingVerify = await Payment.findOne({ studentId: student._id, purpose: 'cert_nano_degree', status: 'pending_verification' });
        certFees.push({
          purpose: "cert_nano_degree",
          label: "Nano Degree Certificate",
          amount: paymentConfig.CERT_PRICES.nano_degree || 1000,
          status: pendingVerify ? "pending_verification" : "unpaid"
        });
      }
    }

    // Fellowship Certificate
    if (student.starStatus && student.starStatus !== 'not_submitted' && student.starStatus !== 'rejected') {
      const successPay = await Payment.findOne({ studentId: student._id, purpose: 'cert_fellowship', status: 'success' });
      if (!successPay) {
        const pendingVerify = await Payment.findOne({ studentId: student._id, purpose: 'cert_fellowship', status: 'pending_verification' });
        certFees.push({
          purpose: "cert_fellowship",
          label: "Fellowship Certificate",
          amount: paymentConfig.CERT_PRICES.fellowship || 2500,
          status: pendingVerify ? "pending_verification" : "unpaid"
        });
      }
    }

    // Fines
    const fines = [];
    if (student.pendingFines && student.pendingFines.length > 0) {
      const unpaidFines = student.pendingFines.filter(f => !f.paid);
      for (const f of unpaidFines) {
        // Find if a payment is pending verification for this fine
        const pendingVerify = await Payment.findOne({ 
          studentId: student._id, 
          purpose: 'fine_low_attendance', 
          status: 'pending_verification' 
        });
        fines.push({
          purpose: "fine_low_attendance",
          label: f.reason || "Attendance Fine (below 75%)",
          amount: f.amount || 400,
          fineId: f._id,
          status: pendingVerify ? "pending_verification" : "unpaid"
        });
      }
    }

    const isComplete = isInternshipComplete(student);
    const donation = { eligible: isComplete };

    return res.json({
      success: true,
      certFees,
      fines,
      donation
    });

  } catch (err) {
    console.error('[PAYMENT] my-obligations error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/v2/payment/initiate
router.post('/initiate', async (req, res) => {
  try {
    const student = await getAuthenticatedStudent(req);
    if (!student) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const { purpose, fineId } = req.body;
    if (!purpose) return res.status(400).json({ success: false, message: 'Purpose is required' });

    const paymentConfig = require('../../config/payment');

    let amount = 0;
    let isEligible = false;

    if (purpose === 'cert_expert') {
      isEligible = student.locStatus && student.locStatus !== 'not_eligible';
      amount = paymentConfig.CERT_PRICES.expert || 100;
      if (isEligible) {
        const successPay = await Payment.findOne({ studentId: student._id, purpose: 'cert_expert', status: 'success' });
        if (successPay) return res.status(400).json({ success: false, message: 'Expert Certificate already paid' });
      }
    } else if (purpose === 'cert_nano_degree') {
      isEligible = student.lorStatus && student.lorStatus !== 'not_eligible';
      amount = paymentConfig.CERT_PRICES.nano_degree || 1000;
      if (isEligible) {
        const successPay = await Payment.findOne({ studentId: student._id, purpose: 'cert_nano_degree', status: 'success' });
        if (successPay) return res.status(400).json({ success: false, message: 'Nano Degree Certificate already paid' });
      }
    } else if (purpose === 'cert_fellowship') {
      isEligible = student.starStatus && student.starStatus !== 'not_submitted' && student.starStatus !== 'rejected';
      amount = paymentConfig.CERT_PRICES.fellowship || 2500;
      if (isEligible) {
        const successPay = await Payment.findOne({ studentId: student._id, purpose: 'cert_fellowship', status: 'success' });
        if (successPay) return res.status(400).json({ success: false, message: 'Fellowship Certificate already paid' });
      }
    } else if (purpose === 'fine_low_attendance') {
      let matchingFine = null;
      if (student.pendingFines && student.pendingFines.length > 0) {
        if (fineId) {
          matchingFine = student.pendingFines.find(f => String(f._id) === String(fineId) && !f.paid);
        } else {
          matchingFine = student.pendingFines.find(f => !f.paid);
        }
      }
      isEligible = !!matchingFine;
      amount = matchingFine ? matchingFine.amount : (paymentConfig.FINE_AMOUNTS.low_attendance || 400);
    } else if (purpose === 'donation') {
      const { isInternshipComplete } = require('../../utils/internshipStatus');
      isEligible = isInternshipComplete(student);
      amount = parseFloat(req.body.amount) || 100;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment purpose' });
    }

    if (!isEligible) {
      return res.status(400).json({ success: false, message: 'You are not eligible for this payment' });
    }

    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const orderId = `PAY-MAN-${randomSuffix}-${Date.now()}`;

    const payment = new Payment({
      orderId,
      studentId: student._id,
      amount: amount,
      provider: 'manual',
      purpose: purpose,
      status: 'pending',
      mode: 'manual',
      metadata: { fineId }
    });
    await payment.save();

    return res.json({
      success: true,
      orderId,
      amount,
      upiId: paymentConfig.BUSINESS_UPI.upiId,
      payeeName: paymentConfig.BUSINESS_UPI.payeeName,
      instructions: 'Pay via UPI and enter UTR to complete.'
    });

  } catch (err) {
    console.error('[PAYMENT] initiate error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/v2/payment/utr-confirm
router.post('/utr-confirm', async (req, res) => {
  try {
    const student = await getAuthenticatedStudent(req);
    if (!student) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const { utr, amount, description, orderId, studentName, employeeId, domain, email } = req.body;
    if (!utr || String(utr).trim().length < 6) {
      return res.status(400).json({ success: false, message: 'Invalid UTR' });
    }

    let payment;
    if (orderId) {
      payment = await Payment.findOne({ orderId });
      if (!payment) {
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }
      // Verify payment ownership
      if (payment.studentId && String(payment.studentId) !== String(student._id)) {
        return res.status(403).json({ success: false, message: 'Unauthorised payment ownership' });
      }

      if (payment.status === 'pending_verification') {
        return res.status(400).json({ success: false, message: 'Transaction ID already submitted — awaiting verification' });
      }
      if (payment.status === 'success') {
        return res.status(400).json({ success: false, message: 'This payment is already verified' });
      }
      if (payment.status === 'failed') {
        return res.status(400).json({ success: false, message: 'This payment was rejected. Please initiate a new payment' });
      }

      // Update payment
      payment.status = 'pending_verification';
      payment.txnUtr = String(utr).trim();
      payment.providerPaymentId = String(utr).trim();
      payment.mode = 'manual';
      payment.invoiceRef = 'UTR-' + String(utr).trim();
      if (description) {
        payment.purpose = description;
        payment.description = description;
      }
      if (amount) {
        const cleanAmount = parseFloat(amount) || 0;
        payment.amount = cleanAmount;
        payment.amountRupees = cleanAmount;
        payment.amountPaisa = Math.round(cleanAmount * 100);
      }
      await payment.save();
    } else {
      // Legacy or custom creation path when orderId is missing
      const generatedOrderId = 'UPIPAY-' + (employeeId || student.employeeId) + '-' + Date.now();
      const cleanAmount = parseFloat(amount) || 0;

      payment = new Payment({
        orderId:        generatedOrderId,
        invoiceRef:     'UTR-' + String(utr).trim(),
        studentId:      student._id,
        employeeId:     student.employeeId,
        amount:         cleanAmount,
        provider:       'manual',
        purpose:        description || 'Direct UPI Payment',
        amountRupees:   cleanAmount,
        amountPaisa:    Math.round(cleanAmount * 100),
        status:         'pending_verification',
        txnUtr:         String(utr).trim(),
        providerPaymentId: String(utr).trim(),
        customerName:   student.name  || '',
        customerEmail:  student.email || '',
        description:    description   || 'Direct UPI Payment',
        paymentUrl:     '',
        mode:           'manual'
      });
      await payment.save();
    }

      // Send confirmation email
      try {
        const { createEmailTransporter } = require('../../utils/mailer');
        const transporter = createEmailTransporter();
        const sName = studentName || student.name || `${student.firstName} ${student.lastName}`;
        const empId = employeeId || student.employeeId;
        const sDomain = domain || student.domain;
        const sEmail = email || student.email;

        transporter.sendMail({
          from: process.env.EMAIL_USER || 'no-reply@entrepreneurshipnetwork.net',
          to: 'growth@entrepreneurshipnetwork.net',
          subject: `Manual Payment Verification Required - ${payment.orderId}`,
          html: `<p>A manual UPI payment has been initiated by <strong>${sName}</strong> (${empId}, ${sDomain}).</p>
                 <p><strong>Order ID:</strong> ${payment.orderId}</p>
                 <p><strong>UTR / Transaction ID:</strong> ${utr}</p>
                 <p><strong>Amount:</strong> ₹${payment.amount}</p>
                 <p><strong>Purpose:</strong> ${payment.purpose}</p>
                 <p><strong>Student Email:</strong> ${sEmail}</p>
                 <p>Please log in to the HR / admin portal to verify and approve this payment.</p>`
        }).catch(err => console.log('Background email error:', err.message));
      } catch (mailErr) {
        console.log('[PAYMENT] Verification email handled with simulated fallback.');
      }

    try {
      await new Notification({
        title:            '💳 Payment Confirmation Received',
        message:          `Student ${student.employeeId} submitted UTR ${utr} for ₹${payment.amount}. Please verify.`,
        type:             'info',
        from:             'System',
        targetType:       'hr'
      }).save();
    } catch (_) {}

    console.log('[PAYMENT] UTR confirm submitted by', student.employeeId, '| UTR:', utr, '| amount:', payment.amount);
    return res.json({ success: true, message: 'Payment confirmation received. Our team will verify shortly.' });
  } catch (err) {
    console.error('[PAYMENT] utr-confirm error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/v2/payment/my-payments
router.get('/my-payments', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const payments = await Payment.find({ employeeId }).sort({ createdAt: -1 });
    return res.json({ success: true, payments });
  } catch (err) {
    console.error('[PAYMENT] my-payments error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/v2/payment/check-credits
router.get('/check-credits', async (req, res) => {
  try {
    const auth       = req.headers.authorization || '';
    const employeeId = req.headers['x-employee-id'];
    if (!employeeId && !auth.startsWith('Bearer hr_')) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    let apiRes;
    try { apiRes = await callPaymentSetuAPI('/check_credits', 'GET', null); }
    catch (netErr) { return res.status(502).json({ success: false, message: 'Gateway unreachable' }); }

    const body    = apiRes.body;
    const credits = body && body.credits ? body.credits : body;
    const warning = credits && credits.remaining_credits < 10
      ? 'Warning: fewer than 10 payment credits remaining.'
      : null;
    return res.json({ success: true, credits, warning });
  } catch (err) {
    console.error('[PAYMENT] check-credits error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/v2/payment/hr-all-payments
router.get('/hr-all-payments', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer hr_')) {
      return res.status(403).json({ success: false, message: 'HR access required' });
    }
    const payments = await Payment.find({}).sort({ createdAt: -1 })
      .populate('studentId', 'name email employeeId domain');
    return res.json({ success: true, total: payments.length, payments });
  } catch (err) {
    console.error('[PAYMENT] hr-all-payments error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/v2/payment/hr-verify
router.post('/hr-verify', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer hr_')) {
      return res.status(403).json({ success: false, message: 'HR access required' });
    }

    const hrUsername = auth.replace('Bearer hr_', '').trim() || 'HR';
    const { orderId, approve, reason } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    const payment = await Payment.findOne({ orderId });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found' });
    }

    if (payment.status === 'success' && approve) {
      return res.status(400).json({ success: false, message: 'Payment is already marked as successful' });
    }

    if (approve) {
      payment.status = 'success';
      payment.verifiedBy = hrUsername;
      payment.verifiedAt = new Date();
      payment.rejectionReason = null;
      await payment.save();

      // Create success notification for student
      try {
        await new Notification({
          title:            '💳 Payment Approved!',
          message:          `Your manual payment of ₹${payment.amountRupees || payment.amount} (UTR: ${payment.txnUtr}) has been approved and verified.`,
          type:             'success',
          from:             'System',
          targetType:       'student',
          targetEmployeeId: payment.employeeId
        }).save();
      } catch (_) {}

      console.log(`[PAYMENT] Approved by ${hrUsername} | orderId: ${orderId}`);
      return res.json({ success: true, message: 'Payment approved successfully.' });
    } else {
      payment.status = 'failed';
      payment.verifiedBy = hrUsername;
      payment.verifiedAt = new Date();
      payment.rejectionReason = reason || 'Verification failed';
      await payment.save();

      // Create failure notification for student
      try {
        await new Notification({
          title:            '❌ Payment Rejected',
          message:          `Your manual payment verification failed. Reason: ${reason || 'Invalid UTR / Transfer details'}.`,
          type:             'error',
          from:             'System',
          targetType:       'student',
          targetEmployeeId: payment.employeeId
        }).save();
      } catch (_) {}

      console.log(`[PAYMENT] Rejected by ${hrUsername} | orderId: ${orderId} | Reason: ${reason}`);
      return res.json({ success: true, message: 'Payment rejected successfully.' });
    }
  } catch (err) {
    console.error('[PAYMENT] hr-verify error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

const TECH_DOMAINS = [
  'devops with aws', 'python development', 'java development',
  'web development', 'mern stack development', 'artificial intelligence',
  'data science', 'cyber security', 'software engineering', 'flutter development'
];

function isTechDomain(domain) {
  if (!domain) return false;
  return TECH_DOMAINS.some(td => domain.toLowerCase().includes(td));
}

// GET /api/v2/payment/tenure-status
router.get('/tenure-status', async (req, res) => {
  try {
    const student = await getAuthenticatedStudent(req);
    if (!student) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const activeDomain = req.query.domain || req.headers['x-active-domain'] || student.domain || '';
    const tenure = (student.tenure || '').trim().toLowerCase();
    
    // Check if tenure requires a payment
    let amount = 0;
    let required = false;
    
    if (tenure === '1 week' || tenure === '1week') {
      amount = 2000;
      required = true;
    } else if (tenure === '15 days' || tenure === '15days') {
      amount = 1500;
      required = true;
    } else if (tenure === '1 month' || tenure === '1month') {
      amount = 1000;
      required = true;
    }

    if (!required) {
      return res.json({ success: true, required: false });
    }

    // New rule: Only students registered on or after July 9, 2026 are required to pay.
    // Existing students can access freely.
    const thresholdDate = new Date('2026-07-09T00:00:00.000Z');
    const studentDate = student.createdAt || (student.joiningDate ? new Date(student.joiningDate) : null);
    if (studentDate && studentDate < thresholdDate) {
      return res.json({ success: true, required: false });
    }

    // Find any existing successful or pending verification tenure payment
    const payment = await Payment.findOne({
      studentId: student._id,
      purpose: { $in: ['TEN Internship Payment', 'tenure_payment'] },
      status: { $in: ['success', 'pending_verification'] }
    });

    const paymentConfig = require('../../config/payment');
    return res.json({
      success: true,
      required: true,
      hasPaid: !!payment,
      status: payment ? payment.status : 'unpaid',
      amount,
      upiId: (paymentConfig.BUSINESS_UPI && paymentConfig.BUSINESS_UPI.upiId) || 'growth@entrepreneurshipnetwork.net',
      payeeName: (paymentConfig.BUSINESS_UPI && paymentConfig.BUSINESS_UPI.payeeName) || 'TEN Ecosystem',
      txnUtr: payment ? payment.txnUtr : null,
      orderId: payment ? payment.orderId : null
    });
  } catch (err) {
    console.error('[PAYMENT] tenure-status error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/v2/payment/tenure-submit
router.post('/tenure-submit', async (req, res) => {
  try {
    const student = await getAuthenticatedStudent(req);
    if (!student) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const { utr, amount } = req.body;
    if (!utr || String(utr).trim().length < 6) {
      return res.status(400).json({ success: false, message: 'Invalid UTR' });
    }

    const activeDomain = req.body.domain || req.headers['x-active-domain'] || student.domain || '';

    const tenure = (student.tenure || '').trim().toLowerCase();
    let expectedAmount = 0;
    if (tenure === '1 week' || tenure === '1week') expectedAmount = 2000;
    else if (tenure === '15 days' || tenure === '15days') expectedAmount = 1500;
    else if (tenure === '1 month' || tenure === '1month') expectedAmount = 1000;

    if (!expectedAmount) {
      return res.status(400).json({ success: false, message: 'Your tenure does not require this payment' });
    }

    // Double check registration threshold (just in case they shouldn't even be paying)
    const thresholdDate = new Date('2026-07-09T00:00:00.000Z');
    const studentDate = student.createdAt || (student.joiningDate ? new Date(student.joiningDate) : null);
    if (studentDate && studentDate < thresholdDate) {
      return res.status(400).json({ success: false, message: 'Your registration date exempts you from this payment.' });
    }

    // Check if there is already a successful or pending verification payment
    const existing = await Payment.findOne({
      studentId: student._id,
      purpose: { $in: ['TEN Internship Payment', 'tenure_payment'] },
      status: { $in: ['success', 'pending_verification'] }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'Payment or verification is already in progress/completed' });
    }

    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const orderId = `PAY-TEN-${randomSuffix}-${Date.now()}`;

    const payment = new Payment({
      orderId,
      invoiceRef: 'UTR-' + String(utr).trim(),
      studentId: student._id,
      employeeId: student.employeeId,
      amount: parseFloat(amount) || expectedAmount,
      provider: 'manual',
      purpose: 'TEN Internship Payment',
      amountRupees: parseFloat(amount) || expectedAmount,
      amountPaisa: Math.round((parseFloat(amount) || expectedAmount) * 100),
      status: 'pending_verification',
      txnUtr: String(utr).trim(),
      providerPaymentId: String(utr).trim(),
      customerName: student.name || '',
      customerEmail: student.email || '',
      description: `Tenure payment for ${student.tenure} crash course`,
      paymentUrl: '',
      mode: 'manual'
    });
    await payment.save();

    // Notify student
    try {
      await new Notification({
        title: '💳 Payment Submitted for Verification',
        message: `Your tenure payment of ₹${payment.amountRupees} (UTR: ${utr}) is submitted for HR verification.`,
        type: 'info',
        from: 'System',
        targetType: 'student',
        targetEmployeeId: student.employeeId
      }).save();
    } catch (_) {}

    return res.json({ success: true, orderId, message: 'Payment submitted for verification successfully.' });
  } catch (err) {
    console.error('[PAYMENT] tenure-submit error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
