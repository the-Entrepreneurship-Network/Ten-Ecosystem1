// E:\Downloads\Ten-Ecosystem1\middleware\attachUserFromSession.js
// TEMPORARY DEBUG VERSION — logs each step so we can see exactly where
// identity resolution fails. Replace with the clean version once the bug
// is found; don't leave these console.logs in production.
'use strict';

const EcosystemUser = require('../models/EcosystemUser');
const Student = require('../models/Student');

async function resolveEmailForRequest(req) {
  console.log('[DEBUG attachUserFromSession] --- new request ---');
  console.log('[DEBUG] req.session?.student?.email:', req.session && req.session.student && req.session.student.email);
  console.log('[DEBUG] x-employee-id header:', req.headers['x-employee-id']);
  console.log('[DEBUG] x-hr-email header:', req.headers['x-hr-email']);
  console.log('[DEBUG] x-coordinator-email header:', req.headers['x-coordinator-email']);

  if (req.session && req.session.student && req.session.student.email) {
    console.log('[DEBUG] resolved via session.student.email');
    return String(req.session.student.email).trim().toLowerCase();
  }

  const empIdHeader = req.headers['x-employee-id'] || req.headers['employeeid'];
  if (empIdHeader) {
    console.log('[DEBUG] looking up Student with employeeId =', JSON.stringify(empIdHeader));
    const s = await Student.findOne({ employeeId: empIdHeader }).select('email employeeId').lean();
    console.log('[DEBUG] Student.findOne result:', s);
    if (s && s.email) {
      console.log('[DEBUG] resolved via x-employee-id ->', s.email);
      return String(s.email).trim().toLowerCase();
    }
  }

  if (req.headers['x-hr-email']) {
    console.log('[DEBUG] resolved via x-hr-email');
    return String(req.headers['x-hr-email']).trim().toLowerCase();
  }
  if (req.headers['x-coordinator-email']) {
    console.log('[DEBUG] resolved via x-coordinator-email');
    return String(req.headers['x-coordinator-email']).trim().toLowerCase();
  }

  console.log('[DEBUG] no email resolved at all');
  return null;
}

async function attachUserFromSession(req, res, next) {
  try {
    if (req.user) {
      console.log('[DEBUG] req.user already set upstream:', req.user);
      return next();
    }

    const email = await resolveEmailForRequest(req);
    if (!email) {
      console.log('[DEBUG] no email -> req.user stays unset -> requireRole will 401');
      return next();
    }

    console.log('[DEBUG] looking up EcosystemUser with email =', JSON.stringify(email));
    const doc = await EcosystemUser.findOne({ email }).select('_id role email').lean();
    console.log('[DEBUG] EcosystemUser.findOne result:', doc);

    if (doc) {
      req.user = { _id: doc._id, role: doc.role };
      console.log('[DEBUG] req.user SET to:', req.user);
    } else {
      console.warn('[DEBUG] No EcosystemUser found for email:', email, '— this is the failure point.');
    }
    return next();
  } catch (err) {
    console.error('[DEBUG attachUserFromSession] threw an error:', err);
    return next();
  }
}

module.exports = { attachUserFromSession };