const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireRole, verifyAdminCredentials, ROLE_LEVEL } = require('../middleware/adminAuth');

// Load models
const Student      = require('../models/Student');
const HR           = require('../models/HR');
const AdminUser    = require('../models/AdminUser');
const Coordinator  = require('../models/Coordinator');
const Payment      = require('../models/Payment');
const Notification = require('../models/Notification');
const DocumentHistory = require('../models/DocumentHistory');
const AuditLog     = require('../models/AuditLog');
const Attendance   = require('../models/Attendance');
const CertificateRequest = require('../models/CertificateRequest');

// ─── AUTH ────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await verifyAdminCredentials(username, password);
    if (user) {
      req.session.adminUser = {
        userId:       user.userId,
        username:     user.username,
        role:         user.role,
        level:        user.level,
        lastActivity: Date.now()
      };
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Access denied' });
  } catch (err) {
    console.error('[AdminPortal] Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', requireRole(1), (req, res) => {
  req.session.adminUser = null;
  res.json({ success: true });
});

router.get('/session-check', requireRole(1), (req, res) => {
  const { username, role, level } = req.session.adminUser;
  res.json({ success: true, user: username, role, level });
});

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────

router.get('/stats', requireRole(1), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().split('T')[0];

    const [
      totalStudents, totalHRs, totalCoordinators, activeToday,
      pendingPayments, pendingCertRequests, lockedAccounts, newToday
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

    const domainBreakdown = await Student.aggregate([
      { $group: { _id: '$domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        totalStudents, totalHRs, totalCoordinators, activeToday,
        pendingPayments, pendingCertRequests, lockedAccounts,
        newRegistrationsToday: newToday,
        domainBreakdown: domainBreakdown.map(d => ({ domain: d._id || 'Unknown', count: d.count }))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PAYMENTS (level 2+ read; level 4+ write) ────────────────────────────────

router.get('/payments/pending', requireRole(2), async (req, res) => {
  try {
    const payments = await Payment.find({
      mode: 'manual', status: 'pending_verification'
    }).sort({ createdAt: 1 });

    const enriched = await Promise.all(payments.map(async (p) => {
      let student = null;
      try { student = await Student.findById(p.studentId).select('name employeeId domain email'); } catch (e) {}
      return {
        ...p.toObject(),
        studentName:       student ? student.name       : 'Unknown',
        studentEmployeeId: student ? student.employeeId : 'Unknown',
        studentDomain:     student ? student.domain     : 'Unknown',
        studentEmail:      student ? student.email      : ''
      };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payments/all', requireRole(2), async (req, res) => {
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
      try { student = await Student.findById(p.studentId).select('name employeeId domain'); } catch (e) {}
      return {
        ...p.toObject(),
        studentName:       student ? student.name       : 'Unknown',
        studentEmployeeId: student ? student.employeeId : 'Unknown',
        studentDomain:     student ? student.domain     : 'Unknown'
      };
    }));

    res.json({ success: true, data: enriched, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PURPOSE_LABELS = {
  cert_expert:       'Expert Certificate (₹100)',
  cert_nano_degree:  'Nano Degree Certificate (₹1000)',
  cert_fellowship:   'Fellowship Certificate (₹2500)',
  fine_low_attendance: 'Attendance Fine (₹400)',
  donation:          'Program Donation',
  tenure_1week:      '1 Week Course Fee — ₹2,000',
  tenure_15days:     '15 Days Course Fee — ₹1,500',
  tenure_1month:     '1 Month Course Fee — ₹1,000',
  'tenure_1 week':   '1 Week Course Fee — ₹2,000',
  'tenure_15 days':  '15 Days Course Fee — ₹1,500',
  'tenure_1 month':  '1 Month Course Fee — ₹1,000'
};

router.post('/payments/verify/:paymentId', requireRole(4), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    const payment = await Payment.findById(req.params.paymentId);

    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'success') return res.status(400).json({ error: 'Already approved — cannot re-process' });
    if (payment.status === 'failed')  return res.status(400).json({ error: 'Already rejected — cannot re-process' });

    const student = await Student.findById(payment.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    payment.verifiedBy = req.session.adminUser.username;
    payment.verifiedAt = new Date();

    if (action === 'approve') {
      payment.status = 'success';
      await payment.save();

      try {
        if (['cert_expert', 'cert_nano_degree', 'cert_fellowship'].includes(payment.purpose)) {
          const typeMap = { cert_expert: 'expert', cert_nano_degree: 'nano_degree', cert_fellowship: 'fellowship' };
          const certType = typeMap[payment.purpose];
          const { generateAndSaveCert } = require('./v2/certificates');
          await generateAndSaveCert(payment.studentId, certType, student, 'admin');
          await DocumentHistory.logSend({
            studentId: student._id, studentName: student.name, studentEmail: student.email,
            employeeId: student.employeeId, college: student.college || student.collegeName,
            domain: student.domain, documentType: certType, documentKey: certType,
            sentBy: 'admin', sentToEmail: student.email, method: 'manual'
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

      if (payment.purpose && payment.purpose.startsWith('tenure_')) {
        try {
          const updateResult = await Student.updateOne(
            { _id: payment.studentId },
            { $set: { shortCoursePaid: true, shortCoursePaymentVerified: true, shortCoursePaymentId: payment.orderId || String(payment._id) } }
          );
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
        }
      }

      await Notification.notifyStudent(student, {
        title: 'Payment Approved ✓',
        message: `Your payment for ${PURPOSE_LABELS[payment.purpose] || payment.purpose} has been approved and processed.`,
        type: 'success'
      });
      await AuditLog.create({
        userId: student._id, actionType: 'payment_approved', performedBy: req.session.adminUser.username,
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

      if (payment.purpose && payment.purpose.startsWith('tenure_')) {
        try {
          const tenureStudent = await Student.findById(payment.studentId);
          if (tenureStudent) { tenureStudent.shortCoursePaymentId = null; await tenureStudent.save(); }
        } catch (e) { console.error('[Admin] Error resetting tenure student on reject:', e.message); }
      }

      await Notification.notifyStudent(student, {
        title: 'Payment Rejected',
        message: `Your payment for ${PURPOSE_LABELS[payment.purpose] || payment.purpose} was rejected. Reason: ${rejectionReason}. You may submit a new payment.`,
        type: 'warning'
      });
      await AuditLog.create({
        userId: student._id, actionType: 'payment_rejected', performedBy: req.session.adminUser.username,
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

router.post('/tenure-payment/approve/:orderId', requireRole(4), async (req, res) => {
  try {
    const payment = await Payment.findOne({ orderId: req.params.orderId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'success') return res.status(400).json({ error: 'Already approved' });

    payment.status = 'success';
    payment.verifiedBy = req.session.adminUser.username;
    payment.verifiedAt = new Date();
    await payment.save();

    const updateResult = await Student.updateOne(
      { _id: payment.studentId },
      { $set: { shortCoursePaid: true, shortCoursePaymentVerified: true } }
    );
    let student = null;
    if (!updateResult || updateResult.matchedCount === 0) {
      student = await Student.findById(payment.studentId);
      if (student) { student.shortCoursePaid = true; student.shortCoursePaymentVerified = true; await student.save(); }
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
      actionType: 'tenure_payment_approved', performedBy: req.session.adminUser.username,
      description: `Approved tenure payment ${req.params.orderId}`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tenure-payment/reject/:orderId', requireRole(4), async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tenure-payment/pending', requireRole(2), async (req, res) => {
  try {
    const payments = await Payment.find({
      purpose: { $regex: /^tenure_/ }, status: 'pending_verification'
    }).sort({ createdAt: 1 });

    const enriched = await Promise.all(payments.map(async p => {
      let student = null;
      try { student = await Student.findById(p.studentId).select('name employeeId domain tenure'); } catch (e) {}
      return { ...p.toObject(), studentName: student?.name, studentEmployeeId: student?.employeeId, studentDomain: student?.domain, studentTenure: student?.tenure };
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payments/export', requireRole(4), async (req, res) => {
  try {
    const payments = await Payment.find({}).sort({ createdAt: -1 });
    const rows = [['Order ID','Student ID','Purpose','Amount','Status','UTR','Created At','Verified At','Verified By','Rejection Reason']];
    for (const p of payments) {
      let student = null;
      try { student = await Student.findById(p.studentId).select('name employeeId'); } catch (e) {}
      rows.push([
        p.orderId || p._id, student ? student.employeeId : 'Unknown',
        PURPOSE_LABELS[p.purpose] || p.purpose, p.amount, p.status,
        p.providerPaymentId || '',
        p.createdAt ? p.createdAt.toISOString() : '',
        p.verifiedAt ? p.verifiedAt.toISOString() : '',
        p.verifiedBy || '', p.rejectionReason || ''
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

// ─── STUDENTS (level 1+ read; level 5+ edit/unlock/reset; level 9+ delete) ───

router.get('/students', requireRole(1), async (req, res) => {
  try {
    const { domain, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (domain) filter.domain = domain;
    if (search) {
      filter.$or = [
        { name:       { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { email:      { $regex: search, $options: 'i' } }
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [students, total] = await Promise.all([
      Student.find(filter)
        .select('name employeeId email domain tenure joiningDate locStatus lorStatus starStatus isLockedOut failedLoginAttempts createdAt')
        .skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      Student.countDocuments(filter)
    ]);
    res.json({ success: true, data: students, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/students/:id', requireRole(1), async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/students/:id', requireRole(5), async (req, res) => {
  try {
    const ALLOWED = ['name','email','domain','tenure','joiningDate','whatsapp','gender','college','collegeName'];
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const student = await Student.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    await AuditLog.create({
      userId: student._id, actionType: 'student_updated', performedBy: req.session.adminUser.username,
      description: `Admin updated student ${student.employeeId}: ${Object.keys(update).join(', ')}`,
      newState: update
    });
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/students/:id/unlock', requireRole(5), async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    student.isLockedOut = false;
    student.failedLoginAttempts = 0;
    student.lockoutUntil = null;
    await student.save();
    await AuditLog.create({
      userId: student._id, actionType: 'student_unlocked', performedBy: req.session.adminUser.username,
      description: `Admin unlocked account for ${student.employeeId}`
    });
    res.json({ success: true, message: 'Account unlocked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/students/:id/reset-password', requireRole(5), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hashed = await bcrypt.hash(newPassword, 10);
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    student.password = hashed;
    student.plainPassword = newPassword;
    await student.save();
    await AuditLog.create({
      userId: student._id, actionType: 'student_password_reset', performedBy: req.session.adminUser.username,
      description: `Admin reset password for ${student.employeeId}`
    });
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/students/:id', requireRole(9), async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const successfulPayment = await Payment.findOne({ studentId: student._id, status: 'success' });
    if (successfulPayment) return res.status(400).json({ error: 'Cannot delete student with successful payments' });
    await Student.findByIdAndDelete(req.params.id);
    await AuditLog.create({
      userId: student._id, actionType: 'student_deleted', performedBy: req.session.adminUser.username,
      description: `Admin deleted student ${student.employeeId} (${student.email})`
    });
    res.json({ success: true, message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HRs (level 9+ / admin only) ─────────────────────────────────────────────

router.get('/hrs', requireRole(9), async (req, res) => {
  try {
    const hrs = await HR.find({}).select('username name email role employeeId createdAt');
    res.json({ success: true, data: hrs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/hrs', requireRole(9), async (req, res) => {
  try {
    const { username, email, name, password, role = 'hr_1' } = req.body;
    const validRoles = ['hr_1','hr_2','hr_3','hr_4','hr_5','hr_6','hr_7','hr_8'];
    if (!username || !email || !name || !password) return res.status(400).json({ error: 'username, email, name, and password are required' });
    if (!validRoles.includes(role)) return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hashed = await bcrypt.hash(password, 10);
    const hr = await HR.create({ username, email, name, password: hashed, role });
    await AuditLog.create({
      actionType: 'hr_created', performedBy: req.session.adminUser.username,
      description: `Admin created HR account: ${username} (${role})`
    });
    res.json({ success: true, data: { _id: hr._id, username: hr.username, email: hr.email, role: hr.role } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/hrs/:id/level', requireRole(9), async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['hr_1','hr_2','hr_3','hr_4','hr_5','hr_6','hr_7','hr_8'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    const hr = await HR.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!hr) return res.status(404).json({ error: 'HR not found' });
    await AuditLog.create({
      userId: hr._id, actionType: 'hr_level_changed', performedBy: req.session.adminUser.username,
      description: `Admin changed HR ${hr.username} role to ${role}`
    });
    res.json({ success: true, data: { _id: hr._id, username: hr.username, role: hr.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/hrs/:id/reset-password', requireRole(9), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
    const hashed = await bcrypt.hash(newPassword, 10);
    const hr = await HR.findByIdAndUpdate(req.params.id, { password: hashed }, { new: true });
    if (!hr) return res.status(404).json({ error: 'HR not found' });
    await AuditLog.create({ userId: hr._id, actionType: 'hr_password_reset', performedBy: req.session.adminUser.username, description: `Admin reset HR password: ${hr.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/hrs/:id', requireRole(9), async (req, res) => {
  try {
    const hr = await HR.findByIdAndDelete(req.params.id);
    if (!hr) return res.status(404).json({ error: 'HR not found' });
    await AuditLog.create({ userId: hr._id, actionType: 'hr_deleted', performedBy: req.session.adminUser.username, description: `Admin deleted HR: ${hr.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN USER MANAGEMENT (founder only — level 10) ─────────────────────────

router.get('/admin-users', requireRole(10), async (req, res) => {
  try {
    const admins = await AdminUser.find({ role: 'admin' }).select('username email role isActive createdBy lastLogin createdAt');
    res.json({ success: true, data: admins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin-users', requireRole(10), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'username, email, and password are required' });
    if (password.length < 12) return res.status(400).json({ error: 'Admin passwords must be at least 12 characters' });
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await AdminUser.create({
      username, email, passwordHash, role: 'admin',
      createdBy: req.session.adminUser.username
    });
    await AuditLog.create({
      actionType: 'admin_created', performedBy: req.session.adminUser.username,
      description: `Founder created admin account: ${username}`
    });
    res.json({ success: true, data: { _id: admin._id, username: admin.username, email: admin.email, role: admin.role } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin-users/:id', requireRole(10), async (req, res) => {
  try {
    const admin = await AdminUser.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Admin user not found' });
    if (admin.role === 'founder') return res.status(400).json({ error: 'Cannot delete a founder account via this endpoint' });
    await AdminUser.findByIdAndDelete(req.params.id);
    await AuditLog.create({
      actionType: 'admin_deleted', performedBy: req.session.adminUser.username,
      description: `Founder deleted admin account: ${admin.username}`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── COORDINATORS (level 6+) ──────────────────────────────────────────────────

router.get('/coordinators', requireRole(6), async (req, res) => {
  try {
    const coords = await Coordinator.find({}).select('username name email domain employeeId verificationStatus createdAt');
    res.json({ success: true, data: coords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/coordinators/:id/reset-password', requireRole(6), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
    const hashed = await bcrypt.hash(newPassword, 10);
    const coord = await Coordinator.findByIdAndUpdate(req.params.id, { password: hashed }, { new: true });
    if (!coord) return res.status(404).json({ error: 'Coordinator not found' });
    await AuditLog.create({ userId: coord._id, actionType: 'coordinator_password_reset', performedBy: req.session.adminUser.username, description: `Admin reset coordinator password: ${coord.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/coordinators/:id', requireRole(6), async (req, res) => {
  try {
    const coord = await Coordinator.findByIdAndDelete(req.params.id);
    if (!coord) return res.status(404).json({ error: 'Coordinator not found' });
    await AuditLog.create({ userId: coord._id, actionType: 'coordinator_deleted', performedBy: req.session.adminUser.username, description: `Admin deleted coordinator: ${coord.username}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CERTIFICATES (level 2+ read; level 3+ approve/reject) ───────────────────

router.get('/certificates/pending', requireRole(3), async (req, res) => {
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

router.post('/certificates/pending/:id/approve', requireRole(3), async (req, res) => {
  try {
    const { approveLoC, approveLor, approveStarPerformance, notes } = req.body;
    const certReq = await CertificateRequest.findById(req.params.id);
    if (!certReq) return res.status(404).json({ error: 'Certificate request not found' });
    if (certReq.status !== 'awaiting_hr') return res.status(400).json({ error: 'Request is not awaiting HR approval' });

    certReq.hrApproved = true;
    certReq.hrApprovedAt = new Date();
    certReq.hrNotes = notes || '';
    if (approveLoC !== undefined) certReq.approveLoC = approveLoC;
    if (approveLor !== undefined) certReq.approveLor = approveLor;
    if (approveStarPerformance !== undefined) certReq.approveStarPerformance = approveStarPerformance;
    certReq.status = 'generating';
    await certReq.save();

    await AuditLog.create({
      userId: certReq.studentId, actionType: 'certificate_approved', performedBy: req.session.adminUser.username,
      description: `HR approved certificate request ${certReq._id}`
    });
    res.json({ success: true, message: 'Certificate request approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/certificates/pending/:id/reject', requireRole(3), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || reason.trim().length < 5) return res.status(400).json({ error: 'Rejection reason required (min 5 characters)' });
    const certReq = await CertificateRequest.findById(req.params.id);
    if (!certReq) return res.status(404).json({ error: 'Certificate request not found' });
    if (certReq.status !== 'awaiting_hr') return res.status(400).json({ error: 'Request is not awaiting HR approval' });

    certReq.hrApproved = false;
    certReq.hrNotes = reason;
    certReq.status = 'failed';
    await certReq.save();

    await AuditLog.create({
      userId: certReq.studentId, actionType: 'certificate_rejected', performedBy: req.session.adminUser.username,
      description: `HR rejected certificate request ${certReq._id}. Reason: ${reason}`
    });
    res.json({ success: true, message: 'Certificate request rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/certificates/history', requireRole(2), async (req, res) => {
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

// ─── NOTIFICATIONS (level 7+) ─────────────────────────────────────────────────

router.post('/notifications/broadcast', requireRole(7), async (req, res) => {
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
      try { await Notification.notifyStudent(s, { title, message, type }); sent++; } catch (e) {}
    }

    await AuditLog.create({
      userId: req.session.adminUser.username, actionType: 'notification_broadcast', performedBy: req.session.adminUser.username,
      description: `Broadcast: "${title}" → ${targetType} (${sent} students)`
    });
    res.json({ success: true, sent, message: `Notification sent to ${sent} students` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SYSTEM INFO (level 1+) ───────────────────────────────────────────────────

router.get('/system/info', requireRole(1), async (req, res) => {
  try {
    const mongoose = require('mongoose');
    res.json({
      success: true,
      data: {
        paymentEnabled:   process.env.PAYMENT_ENABLED === 'true',
        mongoConnected:   mongoose.connection.readyState === 1 && !global.isMongoUnhealthy,
        usingLocalDb:     mongoose.connection.readyState !== 1 || !!global.isMongoUnhealthy,
        nodeEnv:          process.env.NODE_ENV || 'development',
        port:             process.env.PORT || 3000,
        uptimeSeconds:    Math.floor(process.uptime()),
        uptimeFormatted:  (() => { const s = Math.floor(process.uptime()); return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`; })()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AUDIT LOG (level 8+) ─────────────────────────────────────────────────────

router.get('/audit-log', requireRole(8), async (req, res) => {
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

// ─── ATTENDANCE RECALCULATE (level 8+) ────────────────────────────────────────

router.post('/attendance/recalculate-all', requireRole(8), async (req, res) => {
  try {
    const TENURE_DAYS = { '1week': 7, '15days': 15, '1month': 30, '45days': 45, '3months': 90, '6months': 180 };
    const students = await Student.find({});
    let updated = 0, errors = 0;

    for (const student of students) {
      try {
        if (!student.joiningDate) continue;
        const tenure = student.tenure || student.v2DurationType || '1month';
        const totalTenureDays = TENURE_DAYS[tenure] || 30;
        const joiningDate = new Date(student.joiningDate);
        const today = new Date();
        const daysElapsed = Math.min(Math.floor((today - joiningDate) / 86400000) + 1, totalTenureDays);
        const expectedDays = Math.max(daysElapsed, 1);
        const presentCount = await Attendance.countDocuments({ employeeId: student.employeeId, status: 'Present' });
        const percentage = Math.min(Math.round((presentCount / expectedDays) * 100), 100);
        student.calculatedAttendancePercentage = percentage;
        student.attendanceLastCalculated = new Date();
        await student.save();
        updated++;
      } catch (e) { errors++; }
    }

    await AuditLog.create({
      userId: req.session.adminUser.username, actionType: 'attendance_recalculate_all', performedBy: req.session.adminUser.username,
      description: `Recalculated attendance for ${updated} students. Errors: ${errors}`
    });
    res.json({ success: true, updated, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
