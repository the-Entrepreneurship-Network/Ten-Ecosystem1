const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { requireAdminAPI, verifyAdminCredentials, ADMIN_USERNAME } = require('../middleware/adminAuth');
const { broadcastNotification } = require('../utils/sseHub');
const { normalizeDomain } = require('../config/domains');
const { normalizeTenure, getTenureLabel, getInternshipEndDate } = require('../utils/tenure');
const { isEmployeeIdAvailable } = require('../utils/employeeId');
const { propagateStudentChange } = require('../services/studentPropagation');

// Brute-force guard on the admin login. Keyed by IP only — there is a single
// admin account, so there is no per-account key to add and no other user to
// lock out from a shared address.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' }
});

// Load models
const Student = require('../models/Student');
const HR = require('../models/HR');
const Coordinator = require('../models/Coordinator');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const DocumentHistory = require('../models/DocumentHistory');
const AuditLog = require('../models/AuditLog');
const Attendance = require('../models/Attendance');
const CertificateRequest = require('../models/CertificateRequest');
const attendanceUtils = require('../utils/attendanceUtils');
const attendanceDomain = require('../utils/attendanceDomain');

// ─── AUTH ────────────────────────────────────────────────────────────────────

router.post('/login', adminLoginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const isValid = await verifyAdminCredentials(username, password);
    if (isValid) {
      // Regenerate the session id on privilege change (session fixation).
      const grant = () => {
        req.session.adminUser = { username: ADMIN_USERNAME, lastActivity: Date.now() };
        res.json({ success: true });
      };
      if (req.session && typeof req.session.regenerate === 'function') {
        return req.session.regenerate((err) => {
          if (err) {
            console.error('[AdminPortal] Session regeneration failed:', err.message);
            return res.status(500).json({ success: false, error: 'Login failed' });
          }
          grant();
        });
      }
      return grant();
    }

    console.warn('[AdminPortal] Admin authentication rejected.');
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
  } catch (err) {
    console.error('[AdminPortal] Error during login endpoint:', err.message);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

router.post('/logout', requireAdminAPI, (req, res) => {
  req.session.adminUser = null;
  res.json({ success: true });
});

router.get('/session-check', requireAdminAPI, (req, res) => {
  res.json({ success: true, user: req.session.adminUser.username });
});

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────

router.get('/stats', requireAdminAPI, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().split('T')[0];

    const [
      totalStudents,
      totalHRs,
      totalCoordinators,
      activeToday,
      pendingPayments,
      pendingCertRequests,
      lockedAccounts,
      newToday
    ] = await Promise.all([
      Student.countDocuments({}),
      HR.countDocuments({}),
      Coordinator.countDocuments({}),
      Attendance.countDocuments({ dateKey: todayKey, status: 'Present' }),
      Payment.countDocuments({ mode: 'manual', status: 'pending_verification' }),
      CertificateRequest.countDocuments({ status: 'awaiting_hr' }),
      Student.countDocuments({ isLockedOut: true }),
      Student.countDocuments({ createdAt: { $gte: today } })
    ]);

    // Domain breakdown
    const domainBreakdown = await Student.aggregate([
      { $group: { _id: '$domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        totalStudents,
        totalHRs,
        totalCoordinators,
        activeToday,
        pendingPayments,
        pendingCertRequests,
        lockedAccounts,
        newRegistrationsToday: newToday,
        domainBreakdown: domainBreakdown.map(d => ({ domain: d._id || 'Unknown', count: d.count }))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PAYMENTS ────────────────────────────────────────────────────────────────

router.get('/payments/pending', requireAdminAPI, async (req, res) => {
  try {
    const payments = await Payment.find({
      mode: 'manual',
      status: 'pending_verification'
    }).sort({ createdAt: 1 });

    const enriched = await Promise.all(payments.map(async (p) => {
      let student = null;
      try {
        student = await Student.findById(p.studentId).select('name employeeId domain email');
      } catch (e) {}
      return {
        ...p.toObject(),
        studentName: student ? student.name : 'Unknown',
        studentEmployeeId: student ? student.employeeId : 'Unknown',
        studentDomain: student ? student.domain : 'Unknown',
        studentEmail: student ? student.email : ''
      };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payments/all', requireAdminAPI, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [payments, total] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Payment.countDocuments(filter)
    ]);

    const enriched = await Promise.all(payments.map(async (p) => {
      let student = null;
      try {
        student = await Student.findById(p.studentId).select('name employeeId domain');
      } catch (e) {}
      return {
        ...p.toObject(),
        studentName: student ? student.name : 'Unknown',
        studentEmployeeId: student ? student.employeeId : 'Unknown',
        studentDomain: student ? student.domain : 'Unknown'
      };
    }));

    res.json({ success: true, data: enriched, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PURPOSE_LABELS = {
  cert_expert: 'Expert Certificate (₹100)',
  cert_nano_degree: 'Nano Degree Certificate (₹1000)',
  cert_fellowship: 'Fellowship Certificate (₹2500)',
  fine_low_attendance: 'Attendance Fine (₹400)',
  donation: 'Program Donation',
  // Tenure course fees — canonical keys (normalised, no spaces)
  tenure_1week:   '1 Week Course Fee — ₹2,000',
  tenure_15days:  '15 Days Course Fee — ₹1,500',
  tenure_1month:  '1 Month Course Fee — ₹1,000',
  // Fallback keys with spaces (in case purpose was stored before normalisation)
  'tenure_1 week':  '1 Week Course Fee — ₹2,000',
  'tenure_15 days': '15 Days Course Fee — ₹1,500',
  'tenure_1 month': '1 Month Course Fee — ₹1,000'
};

router.post('/payments/verify/:paymentId', requireAdminAPI, async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    const payment = await Payment.findById(req.params.paymentId);

    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'success') return res.status(400).json({ error: 'Already approved — cannot re-process' });
    if (payment.status === 'failed') return res.status(400).json({ error: 'Already rejected — cannot re-process' });

    const student = await Student.findById(payment.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    payment.verifiedBy = req.session.adminUser.username;
    payment.verifiedAt = new Date();

    if (action === 'approve') {
      payment.status = 'success';
      await payment.save();

      // Handle cert generation
      try {
        if (['cert_expert', 'cert_nano_degree', 'cert_fellowship'].includes(payment.purpose)) {
          const typeMap = {
            cert_expert: 'expert',
            cert_nano_degree: 'nano_degree',
            cert_fellowship: 'fellowship'
          };
          const certType = typeMap[payment.purpose];
          const { generateAndSaveCert } = require('./v2/certificates');
          await generateAndSaveCert(payment.studentId, certType, student, 'admin');
          await DocumentHistory.logSend({
            studentId: student._id,
            studentName: student.name,
            studentEmail: student.email,
            employeeId: student.employeeId,
            college: student.college || student.collegeName,
            domain: student.domain,
            documentType: certType,
            documentKey: certType,
            sentBy: 'admin',
            sentToEmail: student.email,
            method: 'manual'
          }, 'manual');
        }

        if (payment.purpose === 'fine_low_attendance') {
          const fine = student.pendingFines && student.pendingFines.find(f => f.fineType === 'low_attendance' && !f.paid);
          if (fine) {
            fine.paid = true;
            if (student.locStatus === 'fine_pending') student.locStatus = 'pending_hr';
            if (student.lorStatus === 'fine_pending') student.lorStatus = 'pending_hr';
            await student.save();
          }
        }
      } catch (certErr) {
        console.error('Cert generation error after payment approval:', certErr);
      }

      // If this is a tenure payment, unlock student access
      if (payment.purpose && payment.purpose.startsWith('tenure_')) {
        try {
          // Use updateOne for maximum reliability in both MongoDB and local-fallback modes
          const updateResult = await Student.updateOne(
            { _id: payment.studentId },
            { $set: {
                shortCoursePaid: true,
                shortCoursePaymentVerified: true,
                shortCoursePaymentId: payment.orderId || String(payment._id)
            }}
          );
          // If updateOne didn't match (e.g. id format mismatch), try findById + save as fallback
          if (!updateResult || updateResult.matchedCount === 0) {
            const tenureStudent = await Student.findById(payment.studentId);
            if (tenureStudent) {
              tenureStudent.shortCoursePaid = true;
              tenureStudent.shortCoursePaymentVerified = true;
              tenureStudent.shortCoursePaymentId = payment.orderId || String(payment._id);
              await tenureStudent.save();
            }
          }
          console.log('[Admin] Tenure payment approved — student access unlocked for studentId:', String(payment.studentId));
        } catch (tenureErr) {
          console.error('[Admin] Error unlocking tenure student:', tenureErr.message);
          // Do not fail the whole approval — log and continue
        }
      }

      await Notification.notifyStudent(student, {
        title: 'Payment Approved ✓',
        message: `Your payment for ${PURPOSE_LABELS[payment.purpose] || payment.purpose} has been approved and processed.`,
        type: 'success'
      });

      await AuditLog.create({
        userId: student._id,
        actionType: 'payment_approved',
        performedBy: 'admin',
        description: `Admin approved payment ${payment._id} for ${payment.purpose} (₹${payment.amount})`,
        newState: { status: 'success', verifiedBy: req.session.adminUser.username }
      });

      return res.json({ success: true, message: 'Payment approved and processed' });

    } else if (action === 'reject') {
      if (!rejectionReason || rejectionReason.trim().length < 5) {
        return res.status(400).json({ error: 'Rejection reason required (min 5 characters)' });
      }
      payment.status = 'failed';
      payment.rejectionReason = rejectionReason;
      await payment.save();

      // If tenure payment rejected, reset shortCoursePaymentId so student can resubmit
      if (payment.purpose && payment.purpose.startsWith('tenure_')) {
        try {
          const tenureStudent = await Student.findById(payment.studentId);
          if (tenureStudent) {
            tenureStudent.shortCoursePaymentId = null;
            await tenureStudent.save();
          }
        } catch (e) {
          console.error('[Admin] Error resetting tenure student on reject:', e.message);
        }
      }

      await Notification.notifyStudent(student, {
        title: 'Payment Rejected',
        message: `Your payment for ${PURPOSE_LABELS[payment.purpose] || payment.purpose} was rejected. Reason: ${rejectionReason}. You may submit a new payment.`,
        type: 'warning'
      });

      await AuditLog.create({
        userId: student._id,
        actionType: 'payment_rejected',
        performedBy: 'admin',
        description: `Admin rejected payment ${payment._id}. Reason: ${rejectionReason}`,
        newState: { status: 'failed', rejectionReason }
      });

      return res.json({ success: true, message: 'Payment rejected' });
    }

    return res.status(400).json({ error: 'action must be approve or reject' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve tenure payment — unlocks student access
router.post('/tenure-payment/approve/:orderId', requireAdminAPI, async (req, res) => {
  try {
    const payment = await Payment.findOne({ orderId: req.params.orderId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'success') return res.status(400).json({ error: 'Already approved' });

    payment.status = 'success';
    payment.verifiedBy = req.session.adminUser.username;
    payment.verifiedAt = new Date();
    await payment.save();

    // Unlock student — use updateOne for reliability, fallback to findById+save
    const updateResult = await Student.updateOne(
      { _id: payment.studentId },
      { $set: { shortCoursePaid: true, shortCoursePaymentVerified: true } }
    );
    let student = null;
    if (!updateResult || updateResult.matchedCount === 0) {
      student = await Student.findById(payment.studentId);
      if (student) {
        student.shortCoursePaid = true;
        student.shortCoursePaymentVerified = true;
        await student.save();
      }
    } else {
      student = await Student.findById(payment.studentId);
    }
    if (student) {
      await Notification.notifyStudent(student, {
        title: 'Payment Verified ✓',
        message: 'Your course fee has been verified. You now have full access to all content.',
        type: 'success'
      });
    }
    await AuditLog.create({
      actionType: 'tenure_payment_approved',
      performedBy: 'admin',
      description: `Approved tenure payment ${req.params.orderId}`
    });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject tenure payment
router.post('/tenure-payment/reject/:orderId', requireAdminAPI, async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const payment = await Payment.findOne({ orderId: req.params.orderId });
    if (!payment) return res.status(404).json({ error: 'Not found' });

    payment.status = 'failed';
    payment.rejectionReason = rejectionReason;
    payment.verifiedBy = req.session.adminUser.username;
    payment.verifiedAt = new Date();
    await payment.save();

    const student = await Student.findById(payment.studentId);
    if (student) {
      await Notification.notifyStudent(student, {
        title: 'Payment Rejected',
        message: `Your payment was rejected. Reason: ${rejectionReason}. Please resubmit.`,
        type: 'warning'
      });
    }
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending tenure payments
router.get('/tenure-payment/pending', requireAdminAPI, async (req, res) => {
  try {
    const payments = await Payment.find({
      purpose: { $regex: /^tenure_/ },
      status: 'pending_verification'
    }).sort({ createdAt: 1 });

    const enriched = await Promise.all(payments.map(async p => {
      let student = null;
      try { student = await Student.findById(p.studentId).select('name employeeId domain tenure'); } catch(e) {}
      return { ...p.toObject(), studentName: student?.name, studentEmployeeId: student?.employeeId, studentDomain: student?.domain, studentTenure: student?.tenure };
    }));
    res.json({ success: true, data: enriched });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payments/export', requireAdminAPI, async (req, res) => {
  try {
    const payments = await Payment.find({}).sort({ createdAt: -1 });
    const rows = [
      ['Order ID', 'Student ID', 'Purpose', 'Amount', 'Status', 'UTR', 'Created At', 'Verified At', 'Verified By', 'Rejection Reason']
    ];
    for (const p of payments) {
      let student = null;
      try { student = await Student.findById(p.studentId).select('name employeeId'); } catch (e) {}
      rows.push([
        p.orderId || p._id,
        student ? student.employeeId : 'Unknown',
        PURPOSE_LABELS[p.purpose] || p.purpose,
        p.amount,
        p.status,
        p.providerPaymentId || '',
        p.createdAt ? p.createdAt.toISOString() : '',
        p.verifiedAt ? p.verifiedAt.toISOString() : '',
        p.verifiedBy || '',
        p.rejectionReason || ''
      ]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STUDENTS ────────────────────────────────────────────────────────────────

router.get('/students', requireAdminAPI, async (req, res) => {
  try {
    const { domain, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (domain) filter.domain = domain;
    if (search) {
      // firstName/lastName are searched too: a record whose `name` never got
      // set is exactly the one an admin is hunting for, and searching only
      // `name` could not find it by name at all.
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [students, total] = await Promise.all([
      Student.find(filter)
        // mustChange* drive the "Reset pending" badge: without them there is no
        // way to tell an account still sitting on an admin-set password from
        // one the student has since taken back over.
        // firstName/lastName ride along so the console can fall back to them
        // for a record whose `name` was never written.
        .select('name firstName lastName employeeId email domain tenure joiningDate locStatus lorStatus starStatus isLockedOut failedLoginAttempts createdAt mustChangePassword mustChangeEmail')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Student.countDocuments(filter)
    ]);
    res.json({ success: true, data: students, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/students/:id', requireAdminAPI, async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Edit any detail on a student (section 15).
 *
 * Widened from the previous nine fields to everything the task document names,
 * with the constraints that matter enforced here:
 *   - employeeId must stay unique (section 1.3)
 *   - domain and tenure must be real values, not free text
 *   - internship dates stay consistent with the tenure
 *
 * AuditLog now records oldState as well as newState. Every caller only ever set
 * newState, so the log could say what a field became but never what it was —
 * and the section's Definition of Done asks for both.
 */
const ADMIN_EDITABLE_FIELDS = [
  'name', 'firstName', 'lastName', 'email', 'whatsapp',
  'domain', 'tenure', 'joiningDate', 'gender',
  'college', 'collegeName', 'employeeId',
  'internshipStartDate', 'internshipEndDate', 'joinerType', 'preportalAbsentDays'
];

router.put('/students/:id', requireAdminAPI, async (req, res) => {
  try {
    const existing = await Student.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Student not found' });

    const update = {};
    for (const key of ADMIN_EDITABLE_FIELDS) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No editable fields supplied' });
    }

    // Domain must be one we recognise, so it cannot drift out of the enum the
    // task engine and employee-ID generator rely on.
    if (update.domain !== undefined) {
      const domain = normalizeDomain(update.domain);
      if (!domain) return res.status(400).json({ error: `Unknown domain: ${update.domain}` });
      update.domain = domain;
    }

    // Tenure must be real, and v2DurationType must follow it — the two drifting
    // apart is the root of the section 6.1 mismatch.
    if (update.tenure !== undefined) {
      const durationType = normalizeTenure(update.tenure);
      if (!durationType) return res.status(400).json({ error: `Unknown tenure: ${update.tenure}` });
      update.tenure = getTenureLabel(durationType);
      update.v2DurationType = durationType;
    }

    // Employee IDs are unique (section 1.3).
    if (update.employeeId !== undefined && update.employeeId !== existing.employeeId) {
      const availability = await isEmployeeIdAvailable(update.employeeId, existing._id);
      if (!availability.available) return res.status(409).json({ error: availability.reason });
    }

    // Keep the end date consistent whenever the tenure or start date moves.
    const effectiveTenure = update.tenure !== undefined ? update.tenure : existing.tenure;
    const effectiveStart = update.internshipStartDate || update.joiningDate
      || existing.internshipStartDate || existing.joiningDate;
    if ((update.tenure !== undefined || update.joiningDate !== undefined || update.internshipStartDate !== undefined)
        && effectiveStart && effectiveTenure) {
      const end = getInternshipEndDate(effectiveStart, effectiveTenure);
      if (end) update.internshipEndDate = end;
    }

    // Snapshot only the fields being changed, so the log is readable.
    const oldState = {};
    for (const key of Object.keys(update)) oldState[key] = existing[key];

    const student = await Student.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });

    // This route already derived v2DurationType and internshipEndDate, but the
    // Task Journey was left untouched — task rows are assigned once at
    // enrolment and never revisited, so a tenure or domain change here did not
    // reach the student's actual task list.
    const propagation = await propagateStudentChange({
      student,
      before: { tenure: existing.tenure, domain: existing.domain,
                joiningDate: existing.joiningDate, internshipStartDate: existing.internshipStartDate },
      actor: req.session.adminUser?.username || 'admin'
    });

    await AuditLog.create({
      userId: student._id,
      actionType: 'student_updated',
      performedBy: req.session.adminUser?.username || 'admin',
      description: `Admin updated student ${student.employeeId}: ${Object.keys(update).join(', ')}`,
      oldState,
      newState: update
    });

    // If domain or tenure changed after an offer letter was issued, the PDF now
    // disagrees with the record. Tell the admin so they can reissue — the two
    // silently drifting apart is exactly issue 6.1.
    const identityChanged = update.domain !== undefined || update.tenure !== undefined;
    const hasIssuedOffer = !!existing.offerPdfBase64 ||
      ['issued', 'approved'].includes(existing.offerLetterStatus);

    res.json({
      success: true,
      data: student,
      propagated: propagation,
      offerLetterNeedsRegeneration: identityChanged && hasIssuedOffer,
      offerLetterMessage: (identityChanged && hasIssuedOffer)
        ? "This student's offer letter was issued with the previous domain/tenure and no longer matches their record. Regenerate it so the two agree."
        : null
    });
  } catch (err) {
    console.error('[admin] student update failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Extend (or change) a student's tenure — section 15.
 *
 * Updates tenure, v2DurationType and the internship dates together, so the
 * attendance day targets, the task journey and the offer-letter data all agree
 * afterwards. There was no endpoint for this at all.
 */
router.post('/students/:id/extend-tenure', requireAdminAPI, async (req, res) => {
  try {
    const { tenure, internshipStartDate } = req.body || {};

    const durationType = normalizeTenure(tenure);
    if (!durationType) {
      return res.status(400).json({ error: 'Please choose a valid tenure (1 Week, 15 Days, 1 Month, 45 Days, 3 Months or 6 Months).' });
    }

    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const startDate = internshipStartDate
      || student.internshipStartDate
      || student.joiningDate
      || student.createdAt;
    const endDate = getInternshipEndDate(startDate, durationType);

    const oldState = {
      tenure: student.tenure,
      v2DurationType: student.v2DurationType,
      internshipStartDate: student.internshipStartDate,
      internshipEndDate: student.internshipEndDate
    };
    const update = {
      tenure: getTenureLabel(durationType),
      v2DurationType: durationType,
      internshipEndDate: endDate
    };
    if (internshipStartDate) update.internshipStartDate = new Date(internshipStartDate);

    const updated = await Student.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });

    // Extending a tenure without resyncing left the student on the old number
    // of weeks — the record said 3 Months and the Task Journey still showed 4
    // weeks of the 1-Month plan.
    const propagation = await propagateStudentChange({
      student: updated,
      before: { tenure: oldState.tenure, internshipStartDate: oldState.internshipStartDate },
      actor: req.session.adminUser?.username || 'admin'
    });

    await AuditLog.create({
      userId: student._id,
      actionType: 'student_tenure_extended',
      performedBy: req.session.adminUser?.username || 'admin',
      description: `Tenure ${oldState.tenure || 'unset'} → ${update.tenure} for ${student.employeeId}`,
      oldState,
      newState: update
    });

    const hasIssuedOffer = !!student.offerPdfBase64 ||
      ['issued', 'approved'].includes(student.offerLetterStatus);

    res.json({
      success: true,
      data: updated,
      propagated: propagation,
      previousTenure: oldState.tenure,
      newTenure: update.tenure,
      internshipEndDate: endDate,
      offerLetterNeedsRegeneration: hasIssuedOffer,
      offerLetterMessage: hasIssuedOffer
        ? "This student's offer letter states the previous duration. Regenerate it so the two agree."
        : null
    });
  } catch (err) {
    console.error('[admin] extend tenure failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/students/:id/unlock', requireAdminAPI, async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const oldState = {
      isLockedOut: student.isLockedOut,
      failedLoginAttempts: student.failedLoginAttempts,
      lockoutUntil: student.lockoutUntil
    };
    student.isLockedOut = false;
    student.failedLoginAttempts = 0;
    student.lockoutUntil = null;
    await student.save();
    await AuditLog.create({
      userId: student._id,
      actionType: 'student_unlocked',
      performedBy: req.session.adminUser?.username || 'admin',
      description: `Admin unlocked account for ${student.employeeId}`,
      oldState,
      newState: { isLockedOut: false, failedLoginAttempts: 0, lockoutUntil: null }
    });
    res.json({ success: true, message: 'Account unlocked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Give a student a way back into their account — password, email, or both.
 *
 * Students who are registered and working get locked out: a mistyped email at
 * registration that no reset link can ever reach, a forgotten password on an
 * account whose email is wrong, a lockout that outlasts anyone's patience. An
 * admin needs to be able to hand them working credentials.
 *
 * What that must NOT do is leave the account sitting on a password somebody
 * else chose and knows. So both changes raise a flag, and the student's next
 * sign-in stops on a screen asking them to set their own password (and confirm
 * their own email, if that was changed) before they can go anywhere. See
 * POST /api/student/security/* in server.js for the other half.
 *
 * `requireChange: false` skips the prompt — for the case where an admin is
 * correcting an obvious typo and there is nothing for the student to redo.
 */
async function resetStudentCredentials(req, res) {
  try {
    const body = req.body || {};
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const newEmail = typeof body.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : '';
    const requireChange = body.requireChange !== false;

    if (!newPassword && !newEmail) {
      return res.status(400).json({ error: 'Supply a new password, a new email, or both.' });
    }
    if (newPassword && newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    // Deliberately permissive but real: something@something.tld. A stricter
    // pattern rejects valid addresses, and this is the address a locked-out
    // student's only way back in will be sent to.
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail)) {
      return res.status(400).json({ error: 'That does not look like a valid email address.' });
    }

    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // An email already on another account would give two students the same
    // sign-in identifier, and the email branch of /login resolves exactly one.
    if (newEmail && newEmail !== String(student.email || '').toLowerCase()) {
      const clash = await Student.findOne({
        email: new RegExp('^' + newEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
        _id: { $ne: student._id }
      }).select('employeeId').lean();
      if (clash) {
        return res.status(409).json({ error: `That email is already used by ${clash.employeeId}.` });
      }
    }

    const oldState = {
      email: student.email,
      mustChangePassword: student.mustChangePassword,
      mustChangeEmail: student.mustChangeEmail
    };
    const changed = [];

    if (newPassword) {
      student.password = await bcrypt.hash(newPassword, 10);
      student.mustChangePassword = requireChange;
      changed.push('password');
    }
    if (newEmail && newEmail !== String(student.email || '').toLowerCase()) {
      student.previousEmail = student.email || null;
      student.email = newEmail;
      student.mustChangeEmail = requireChange;
      changed.push('email');
    }

    // A student who could not get in was very likely locked out as well.
    // Leaving the lock on would make the new password look wrong too.
    student.isLockedOut = false;
    student.failedLoginAttempts = 0;
    student.lockoutUntil = null;

    // Any session opened with the old credentials ends here. If the reason for
    // the reset was somebody else in the account, leaving their session alive
    // would defeat the whole exercise.
    student.activeSessionToken = null;
    // A pending reset link issued under the old email must not still work.
    student.passwordResetToken = null;
    student.passwordResetExpiry = null;

    student.credentialResetAt = new Date();
    student.credentialResetBy = req.session.adminUser?.username || 'admin';
    await student.save();

    await AuditLog.create({
      userId: student._id,
      actionType: 'student_credentials_reset',
      performedBy: student.credentialResetBy,
      description: `Admin reset ${changed.join(' and ')} for ${student.employeeId}`,
      // Records THAT the password changed and nothing about its value — never
      // a password, a hash, or even its length.
      oldState: Object.assign({}, oldState, newPassword ? { password: '[redacted]' } : {}),
      newState: {
        email: student.email,
        mustChangePassword: student.mustChangePassword,
        mustChangeEmail: student.mustChangeEmail,
        ...(newPassword ? { password: '[redacted]' } : {})
      }
    });

    res.json({
      success: true,
      changed,
      email: student.email,
      requireChange,
      message: requireChange
        ? `Updated ${changed.join(' and ')}. Give the student these details — they will be asked to set their own when they sign in.`
        : `Updated ${changed.join(' and ')}.`
    });
  } catch (err) {
    console.error('[admin] credential reset failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

router.post('/students/:id/reset-credentials', requireAdminAPI, resetStudentCredentials);

/**
 * Password only — what the older admin screens call. Same handler, so there is
 * one code path and one set of side effects; the email simply is not supplied.
 */
router.post('/students/:id/reset-password', requireAdminAPI, (req, res) => {
  req.body = {
    newPassword: (req.body || {}).newPassword,
    requireChange: (req.body || {}).requireChange
  };
  return resetStudentCredentials(req, res);
});

router.delete('/students/:id', requireAdminAPI, async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const successfulPayment = await Payment.findOne({ studentId: student._id, status: 'success' });
    if (successfulPayment) return res.status(400).json({ error: 'Cannot delete student with successful payments' });
    await Student.findByIdAndDelete(req.params.id);
    await AuditLog.create({
      userId: student._id,
      actionType: 'student_deleted',
      performedBy: req.session.adminUser?.username || 'admin',
      description: `Admin deleted student ${student.employeeId} (${student.email})`,
      oldState: {
        employeeId: student.employeeId,
        name: student.name,
        email: student.email,
        domain: student.domain,
        tenure: student.tenure
      },
      newState: {}
    });
    res.json({ success: true, message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HRs ─────────────────────────────────────────────────────────────────────

router.get('/hrs', requireAdminAPI, async (req, res) => {
  try {
    const hrs = await HR.find({}).select('username name email role employeeId createdAt');
    res.json({ success: true, data: hrs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/hrs/:id/reset-password', requireAdminAPI, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
    const hashed = await bcrypt.hash(newPassword, 10);
    const hr = await HR.findByIdAndUpdate(req.params.id, { password: hashed }, { new: true });
    if (!hr) return res.status(404).json({ error: 'HR not found' });
    await AuditLog.create({ userId: hr._id, actionType: 'hr_password_reset', performedBy: 'admin', description: `Admin reset HR password: ${hr.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/hrs/:id', requireAdminAPI, async (req, res) => {
  try {
    const hr = await HR.findByIdAndDelete(req.params.id);
    if (!hr) return res.status(404).json({ error: 'HR not found' });
    await AuditLog.create({ userId: hr._id, actionType: 'hr_deleted', performedBy: 'admin', description: `Admin deleted HR: ${hr.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── COORDINATORS ─────────────────────────────────────────────────────────────

router.get('/coordinators', requireAdminAPI, async (req, res) => {
  try {
    const coords = await Coordinator.find({}).select('username name email domain employeeId verificationStatus createdAt');
    res.json({ success: true, data: coords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/coordinators/:id/reset-password', requireAdminAPI, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
    const hashed = await bcrypt.hash(newPassword, 10);
    const coord = await Coordinator.findByIdAndUpdate(req.params.id, { password: hashed }, { new: true });
    if (!coord) return res.status(404).json({ error: 'Coordinator not found' });
    await AuditLog.create({ userId: coord._id, actionType: 'coordinator_password_reset', performedBy: 'admin', description: `Admin reset coordinator password: ${coord.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/coordinators/:id', requireAdminAPI, async (req, res) => {
  try {
    const coord = await Coordinator.findByIdAndDelete(req.params.id);
    if (!coord) return res.status(404).json({ error: 'Coordinator not found' });
    await AuditLog.create({ userId: coord._id, actionType: 'coordinator_deleted', performedBy: 'admin', description: `Admin deleted coordinator: ${coord.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CERTIFICATES ─────────────────────────────────────────────────────────────

router.get('/certificates/pending', requireAdminAPI, async (req, res) => {
  try {
    const requests = await CertificateRequest.find({ status: 'awaiting_hr' }).sort({ createdAt: 1 });
    const enriched = await Promise.all(requests.map(async (r) => {
      let student = null;
      try { student = await Student.findById(r.studentId).select('name employeeId domain'); } catch (e) {}
      return { ...r.toObject(), studentName: student?.name, studentEmployeeId: student?.employeeId, studentDomain: student?.domain };
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/certificates/history', requireAdminAPI, async (req, res) => {
  try {
    const { page = 1, limit = 50, documentType, studentId } = req.query;
    const filter = {};
    if (documentType) filter.documentType = documentType;
    if (studentId) filter.studentId = studentId;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [docs, total] = await Promise.all([
      DocumentHistory.find(filter).sort({ sentAt: -1 }).skip(skip).limit(parseInt(limit)),
      DocumentHistory.countDocuments(filter)
    ]);
    res.json({ success: true, data: docs, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

router.post('/notifications/broadcast', requireAdminAPI, async (req, res) => {
  try {
    const { title, message, type = 'info', targetType, targetDomain, targetEmployeeId } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Title and message required' });

    let students = [];
    if (targetType === 'all') {
      students = await Student.find({}).select('_id name email');
    } else if (targetType === 'domain' && targetDomain) {
      students = await Student.find({ domain: targetDomain }).select('_id name email');
    } else if (targetType === 'student' && targetEmployeeId) {
      const s = await Student.findOne({ employeeId: targetEmployeeId }).select('_id name email');
      if (s) students = [s];
    }

    let sent = 0;
    for (const s of students) {
      try {
        const notif = await Notification.notifyStudent(s, { title, message, type });
        // Push it live as well as storing it. This loop used to only write the
        // row, so an admin broadcast sat invisible until the student's next
        // poll — the notification bell showed nothing in the meantime.
        if (notif) broadcastNotification(s.domain, s.employeeId, notif);
        sent++;
      } catch (e) {}
    }

    await AuditLog.create({
      userId: req.session.adminUser?.username || 'admin',
      actionType: 'notification_broadcast',
      performedBy: 'admin',
      description: `Admin broadcast: "${title}" → ${targetType} (${sent} students)`
    });

    res.json({ success: true, sent, message: `Notification sent to ${sent} students` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SYSTEM INFO ──────────────────────────────────────────────────────────────

router.get('/system/info', requireAdminAPI, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    res.json({
      success: true,
      data: {
        paymentEnabled: process.env.PAYMENT_ENABLED === 'true',
        mongoConnected: mongoose.connection.readyState === 1 && !global.isMongoUnhealthy,
        usingLocalDb: mongoose.connection.readyState !== 1 || !!global.isMongoUnhealthy,
        nodeEnv: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 3000,
        uptimeSeconds: Math.floor(process.uptime()),
        uptimeFormatted: (() => {
          const s = Math.floor(process.uptime());
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          return `${h}h ${m}m`;
        })()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

router.get('/audit-log', requireAdminAPI, async (req, res) => {
  try {
    const { page = 1, actionType, performedBy } = req.query;
    const filter = {};
    if (actionType) filter.actionType = actionType;
    if (performedBy) filter.performedBy = performedBy;
    const skip = (parseInt(page) - 1) * 50;
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(50),
      AuditLog.countDocuments(filter)
    ]);
    res.json({ success: true, data: logs, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ATTENDANCE RECALCULATE ───────────────────────────────────────────────────

router.post('/attendance/recalculate-all', requireAdminAPI, async (req, res) => {
  try {
    // This used to carry its own copy of the tenure table and its own formula:
    // elapsed CALENDAR days as the denominator, Sundays counted, and
    // `countDocuments({status:'Present'})` as the numerator — which counts a
    // day twice when both the student and their coordinator marked it. So the
    // one button whose whole job is to correct attendance wrote numbers that
    // disagreed with every other screen in the portal. It now runs the shared
    // calculator, the same one the dashboard and the certificate rules use.
    const students = await Student.find({}).select('employeeId').lean();
    let updated = 0, errors = 0;

    for (const student of students) {
      try {
        if (!student.employeeId) continue;
        await attendanceUtils.recomputeAndSaveAttendance(Student, Attendance, student.employeeId);
        updated++;
      } catch (e) { errors++; }
    }

    await AuditLog.create({
      userId: req.session.adminUser?.username || 'admin',
      actionType: 'attendance_recalculate_all',
      performedBy: 'admin',
      description: `Recalculated attendance for ${updated} students. Errors: ${errors}`
    });

    res.json({ success: true, updated, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ATTENDANCE CONTROL ───────────────────────────────────────────────────────
//
// Full read/write on any student's attendance, scoped to a domain. A student
// holding two domains has two independent records, so every route here takes a
// domain and defaults to their primary one — see utils/attendanceDomain.js.

/** Resolve a student by employee ID or Mongo id. */
async function findStudentByRef(ref) {
  if (!ref) return null;
  const byEmployee = await Student.findOne({ employeeId: String(ref).trim() });
  if (byEmployee) return byEmployee;
  if (/^[0-9a-fA-F]{24}$/.test(String(ref))) return Student.findById(ref);
  return null;
}

router.get('/attendance/:ref', requireAdminAPI, async (req, res) => {
  try {
    const student = await findStudentByRef(decodeURIComponent(req.params.ref));
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const domains = attendanceDomain.studentDomains(student);
    const domain = attendanceDomain.resolveActiveDomain(student, req.query.domain);

    const all = await Attendance.find({ employeeId: student.employeeId }).sort({ date: -1 }).lean();
    const records = attendanceDomain.filterByDomain(all, domain, student);
    const summary = attendanceUtils.getAttendanceSummary(records, student);

    res.json({
      success: true,
      student: {
        _id: student._id, name: student.name, employeeId: student.employeeId,
        domain: student.domain, tenure: student.tenure, joiningDate: student.joiningDate
      },
      domain,
      domains,
      summary,
      // Every domain's figures at once, so the admin can see both sides of a
      // dual-domain student without switching.
      perDomain: domains.map((d) => ({
        domain: d,
        summary: attendanceUtils.getAttendanceSummary(
          attendanceDomain.filterByDomain(all, d, student), student)
      })),
      records
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/attendance/mark', requireAdminAPI, async (req, res) => {
  try {
    const { ref, employeeId, date, status, domain, markedBy } = req.body || {};
    const student = await findStudentByRef(ref || employeeId);
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const when = new Date(date || Date.now());
    if (isNaN(when.getTime())) return res.status(400).json({ success: false, error: 'Invalid date' });

    const source = markedBy === 'self' ? 'self' : 'coordinator';
    const st = status === 'Absent' ? 'Absent' : 'Present';
    const markDomain = attendanceDomain.domainForWrite(student, domain);
    const dateKey = attendanceUtils.toDateKey(when);

    let record = await Attendance.findOne({
      employeeId: student.employeeId, dateKey, markedBy: source, domain: markDomain
    });

    const before = record ? record.status : null;
    if (record) {
      record.status = st;
      record.date = when;
      record.coordinatorId = 'ADMIN';
      await record.save();
    } else {
      record = await Attendance.create({
        studentId: student._id, employeeId: student.employeeId, domain: markDomain,
        date: when, dateKey, status: st, markedBy: source,
        coordinatorId: source === 'coordinator' ? 'ADMIN' : '',
        source: 'admin'
      });
    }

    await attendanceUtils.recomputeAndSaveAttendance(Student, Attendance, student.employeeId);

    await AuditLog.create({
      userId: req.session.adminUser?.username || 'admin',
      actionType: 'attendance_mark',
      performedBy: 'admin',
      description: `${before ? 'Changed' : 'Created'} ${source} attendance for ${student.employeeId} / ${markDomain || '(no domain)'} on ${dateKey}: ${before || '—'} → ${st}`,
      oldState: before ? { status: before } : null,
      newState: { status: st, dateKey, domain: markDomain, markedBy: source }
    }).catch(() => {});

    res.json({ success: true, record, domain: markDomain });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'Already marked for that day and domain' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/attendance/record/:id', requireAdminAPI, async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Record not found' });

    await Attendance.deleteOne({ _id: record._id });
    await attendanceUtils.recomputeAndSaveAttendance(Student, Attendance, record.employeeId);

    await AuditLog.create({
      userId: req.session.adminUser?.username || 'admin',
      actionType: 'attendance_delete',
      performedBy: 'admin',
      description: `Deleted ${record.markedBy} attendance for ${record.employeeId} / ${record.domain || '(no domain)'} on ${record.dateKey}`,
      oldState: { status: record.status, dateKey: record.dateKey, domain: record.domain, markedBy: record.markedBy },
      newState: null
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DOCUMENT CONTROL ─────────────────────────────────────────────────────────

router.get('/documents/history', requireAdminAPI, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
    const skip   = (page - 1) * limit;
    const method = req.query.method;
    const q      = String(req.query.q || '').trim();

    // Same rule as the HR view: a row is a send only if it carries the
    // document number that was printed on the paper.
    const filter = {
      documentNumber: { $exists: true, $nin: [null, '', '—'] },
      documentType:   { $exists: true, $nin: [null, ''] }
    };
    if (method === 'manual' || method === 'automation') filter.method = method;
    if (q) {
      const rx = new RegExp(q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      filter.$or = [{ studentName: rx }, { employeeId: rx }, { documentNumber: rx }];
    }

    const [docs, total, manual, automation] = await Promise.all([
      DocumentHistory.find(filter).sort({ sentAt: -1 }).skip(skip).limit(limit).lean(),
      DocumentHistory.countDocuments(filter),
      DocumentHistory.countDocuments({ ...filter, method: 'manual' }),
      DocumentHistory.countDocuments({ ...filter, method: 'automation' })
    ]);

    res.json({
      success: true,
      total, page, counts: { manual, automation },
      data: docs.map((d) => ({
        ...d,
        method: DocumentHistory.resolveMethod(d.method, d.sentBy)
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const ADMIN_DOC_TYPES = ['OFFER', 'LOC', 'LOR', 'STAR', 'LOP'];

router.post('/documents/generate', requireAdminAPI, async (req, res) => {
  try {
    const { ref, employeeId, certType } = req.body || {};
    const type = String(certType || '').toUpperCase();
    if (!ADMIN_DOC_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: `certType must be one of ${ADMIN_DOC_TYPES.join(', ')}` });
    }

    const student = await findStudentByRef(ref || employeeId);
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const who = req.session.adminUser?.username || 'admin';
    const { generateAndSaveCert } = require('./v2/certificates');
    // The sentBy string is what decides Manual vs Automation in Document
    // History, so it names the admin who pressed the button.
    const result = await generateAndSaveCert(
      student._id.toString(), type, student, `Admin Portal (${who})`
    );

    await AuditLog.create({
      userId: who,
      actionType: 'document_generate',
      performedBy: 'admin',
      description: `Generated ${type} for ${student.employeeId}`,
      newState: { certType: type, employeeId: student.employeeId }
    }).catch(() => {});

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   Certificate overrides — what HR issued without the checks passing
   ════════════════════════════════════════════════════════════════════════

   HR can now issue a certificate directly (POST /api/v2/certificates/hr-issue),
   skipping the application, the attendance rule and the performance rule. That
   is deliberate: interns who did the whole internship over WhatsApp have no
   portal record to satisfy any of it. But an issuing power with no visibility
   above it is how a certificate stops meaning anything, so every direct issue
   writes a row and this is where an admin reads them.

   The list defaults to the ones that matter — issues where the student did NOT
   meet the requirements — with a filter for the rest.
   ═══════════════════════════════════════════════════════════════════════ */
const CertificateOverride = require('../models/CertificateOverride');

router.get('/certificate-overrides', requireAdminAPI, async (req, res) => {
  try {
    const { filter = 'all', search = '', page = 1, limit = 50 } = req.query;
    const q = {};
    if (filter === 'unmet') q.metRequirements = false;
    else if (filter === 'met') q.metRequirements = true;
    else if (filter === 'revoked') q.revokedAt = { $ne: null };

    if (search) {
      const rx = new RegExp(String(search).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      q.$or = [{ employeeId: rx }, { studentName: rx }, { issuedBy: rx }, { domain: rx }];
    }

    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim;

    const [rows, total, unmetCount] = await Promise.all([
      CertificateOverride.find(q).sort({ issuedAt: -1 }).skip(skip).limit(lim).lean(),
      CertificateOverride.countDocuments(q),
      CertificateOverride.countDocuments({ metRequirements: false, revokedAt: null })
    ]);

    res.json({ success: true, overrides: rows, total, unmetCount, page: Number(page), limit: lim });
  } catch (err) {
    console.error('[admin/certificate-overrides]', err.message);
    res.status(500).json({ success: false, error: err.message, overrides: [], total: 0, unmetCount: 0 });
  }
});

// The badge on the nav item — cheap enough to poll.
router.get('/certificate-overrides/count', requireAdminAPI, async (req, res) => {
  try {
    const unmetCount = await CertificateOverride.countDocuments({ metRequirements: false, revokedAt: null });
    res.json({ success: true, unmetCount });
  } catch (err) {
    res.json({ success: true, unmetCount: 0 });
  }
});

/**
 * Revoke one.
 *
 * This is the counterweight to the bypass: if HR issued a certificate that
 * should not exist, an admin takes it back. Revoking clears the PDF and resets
 * the status, so the student's My Documents stops offering the download — a
 * revocation that left the file downloadable would be theatre.
 */
router.post('/certificate-overrides/:id/revoke', requireAdminAPI, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const who = (req.session && req.session.adminUser && req.session.adminUser.username) || 'admin';

    const row = await CertificateOverride.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Override not found' });
    if (row.revokedAt) return res.status(400).json({ success: false, error: 'Already revoked' });

    const fieldMap = {
      LOC:   { pdf: 'locPdfBase64',   status: 'locStatus',   date: 'locIssuedAt',   flag: 'locIssuedByOverride',   reset: 'not_eligible' },
      LOR:   { pdf: 'lorPdfBase64',   status: 'lorStatus',   date: 'lorIssuedAt',   flag: 'lorIssuedByOverride',   reset: 'not_eligible' },
      STAR:  { pdf: 'starPdfBase64',  status: 'starStatus',  date: 'starIssuedAt',  flag: 'starIssuedByOverride',  reset: 'not_submitted' },
      OFFER: { pdf: 'offerPdfBase64', status: 'offerLetterStatus', date: 'offerLetterGeneratedAt', flag: 'offerIssuedByOverride', reset: 'not_uploaded' },
      LOP:   { pdf: 'lopPdfBase64',   status: 'lopStatus',   date: 'lopIssuedAt',   flag: 'lopIssuedByOverride',   reset: 'not_eligible' }
    };
    const f = fieldMap[row.certificateType];
    if (f && row.studentId) {
      await Student.findByIdAndUpdate(row.studentId, {
        [f.pdf]: null, [f.status]: f.reset, [f.date]: null, [f.flag]: false
      }).catch((e) => console.error('[revoke] student update failed:', e.message));
    }

    row.revokedAt = new Date();
    row.revokedBy = who;
    row.revokeReason = String(reason || '').slice(0, 1000);
    await row.save();

    await AuditLog.create({
      userId: who,
      actionType: 'certificate_revoke',
      performedBy: 'admin',
      description: `Revoked ${row.certificateType} issued to ${row.employeeId} by ${row.issuedBy}`,
      oldState: { certificateType: row.certificateType, employeeId: row.employeeId, issuedBy: row.issuedBy },
      newState: { revoked: true, reason: row.revokeReason }
    }).catch(() => {});

    res.json({ success: true, message: `${row.certificateType} revoked for ${row.employeeId}.` });
  } catch (err) {
    console.error('[admin/certificate-overrides revoke]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
//  Hackathon & Ideathon — payment verification (admin, not HR)
//
//  Public entrants register through the hackathon portal and pay the entry fee
//  by UPI, then wait here. This is a self-contained queue on the HackathonTeam
//  record — it does NOT touch the student Payment collection or the student
//  portal, so the hackathon stays separate from everything else. No email.
// ─────────────────────────────────────────────────────────────────────────
const HackathonTeam = require('../models/HackathonTeam');

/** GET /api/admin-internal/hackathon-registrations?status=pending|confirmed|rejected|all */
router.get('/hackathon-registrations', requireAdminAPI, async (req, res) => {
  try {
    const status = String(req.query.status || 'pending');
    const filter = {};
    if (status !== 'all') filter.paymentStatus = status;
    // Only teams that went through the paid public flow; legacy logged-in teams
    // (paymentStatus 'unpaid') are not part of this queue.
    if (status === 'all') filter.paymentStatus = { $in: ['pending', 'confirmed', 'rejected'] };

    const teams = await HackathonTeam.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      success: true,
      registrations: teams.map((t) => ({
        id: String(t._id),
        team: t.name,
        event: t.eventTitle,
        track: t.track || '',
        lead: (t.members || []).find((m) => m.isLead) || { name: '', email: '' },
        leadEmail: t.leadEmail,
        leadPhone: t.leadPhone || '',
        memberCount: (t.members || []).length,
        amount: t.paymentAmount || 0,
        utr: t.paymentRef || '',
        paymentStatus: t.paymentStatus,
        paidAt: t.paidAt,
        verifiedBy: t.verifiedBy || '',
        verifiedAt: t.verifiedAt || null,
        rejectionReason: t.rejectionReason || ''
      }))
    });
  } catch (err) {
    console.error('[admin] hackathon list failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/admin-internal/hackathon-registrations/count — pending badge. */
router.get('/hackathon-registrations/count', requireAdminAPI, async (req, res) => {
  try {
    const count = await HackathonTeam.countDocuments({ paymentStatus: 'pending' });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/admin-internal/hackathon-registrations/:id/verify  { action, rejectionReason } */
router.post('/hackathon-registrations/:id/verify', requireAdminAPI, async (req, res) => {
  try {
    const { action, rejectionReason } = req.body || {};
    const team = await HackathonTeam.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Registration not found.' });
    if (team.paymentStatus !== 'pending') {
      return res.status(409).json({ success: false, error: `This registration is already ${team.paymentStatus}.` });
    }
    const who = (req.session.adminUser && req.session.adminUser.username) || 'admin';

    if (action === 'approve') {
      team.paymentStatus = 'confirmed';
      team.status = 'confirmed';
      team.verifiedBy = who;
      team.verifiedAt = new Date();
      team.rejectionReason = '';
      await team.save();
      await AuditLog.create({
        userId: team._id, actionType: 'hackathon_payment_approved', performedBy: 'admin',
        description: `Admin approved hackathon entry for team "${team.name}" (${team.eventTitle}), UTR ${team.paymentRef}`,
        newState: { paymentStatus: 'confirmed', verifiedBy: who }
      }).catch(() => {});
      return res.json({ success: true, message: `${team.name} is confirmed.` });
    }

    if (action === 'reject') {
      if (!rejectionReason || String(rejectionReason).trim().length < 5) {
        return res.status(400).json({ success: false, error: 'Give a reason (at least 5 characters).' });
      }
      team.paymentStatus = 'rejected';
      team.verifiedBy = who;
      team.verifiedAt = new Date();
      team.rejectionReason = String(rejectionReason).trim().slice(0, 500);
      await team.save();
      await AuditLog.create({
        userId: team._id, actionType: 'hackathon_payment_rejected', performedBy: 'admin',
        description: `Admin rejected hackathon entry for team "${team.name}": ${team.rejectionReason}`,
        newState: { paymentStatus: 'rejected', verifiedBy: who }
      }).catch(() => {});
      return res.json({ success: true, message: `${team.name} was rejected.` });
    }

    res.status(400).json({ success: false, error: 'Unknown action.' });
  } catch (err) {
    console.error('[admin] hackathon verify failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
