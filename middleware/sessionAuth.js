'use strict';

/**
 * Session-derived authentication for the v2 route modules.
 *
 * Every v2 router previously rolled its own guard, and all of them trusted the
 * client:
 *
 *   requireStudent  → read employeeId from an `x-employee-id` header, the body
 *                     or the query string, then looked that student up. Any
 *                     caller could act as any student.
 *   requireHR       → `authorization.startsWith("Bearer hr_")`. Any non-empty
 *                     string with that prefix passed.
 *   approve/reject  → `authorization.startsWith("Bearer ")`. Same.
 *
 * Identity here comes from `req.session` only, which nothing but a successful
 * login can write. These guards attach:
 *
 *   req.student      the Student document      (requireStudent)
 *   req.hrUser       { username, email, name, level }   (requireHR)
 *   req.coordinator  { username, domain }      (requireCoordinator)
 */

const Student = require('../models/Student');

function sessionOf(req) {
  return (req && req.session) || null;
}

/** The employeeId of the signed-in student, or "" when there is no session. */
function sessionEmployeeId(req) {
  const session = sessionOf(req);
  return (session && session.student && session.student.employeeId) || '';
}

/**
 * Find the signed-in student from whatever the session holds.
 *
 * This used to be one exact `findOne({ employeeId })`, and that single line
 * produced an unbreakable sign-in loop for individual students. Login finds an
 * account by email OR employeeId, but the session then carried the employeeId
 * alone — so if that field held a trailing space, a different case, or nothing
 * at all, login SUCCEEDED and every request afterwards answered 401. The
 * browser's session guard treats a 401 as "signed out" and returns to the login
 * page, where the student signs in perfectly well again, and round it goes,
 * forever, for that one person while everybody else is fine.
 *
 * establishStudentSession already records _id and email beside the employeeId.
 * So the rule is now: a session that names a real account is a valid session,
 * whatever shape its employeeId happens to be in. Only a session pointing at an
 * account that genuinely no longer exists is rejected.
 */
async function findSessionStudent(req) {
  const ses = (sessionOf(req) || {}).student;
  if (!ses) return null;

  const employeeId = String(ses.employeeId || '').trim();
  if (employeeId) {
    const exact = await Student.findOne({ employeeId });
    if (exact) return exact;
  }

  // The _id is immutable and was captured at sign-in — the most reliable of
  // the three, and the reason a malformed employeeId no longer locks anyone out.
  if (ses._id && /^[a-f0-9]{24}$/i.test(String(ses._id))) {
    const byId = await Student.findById(String(ses._id));
    if (byId) return byId;
  }

  if (ses.email) {
    const byEmail = await Student.findOne({ email: String(ses.email).toLowerCase().trim() });
    if (byEmail) return byEmail;
  }

  // Last resort: the stored id differs only by case or padding.
  if (employeeId) {
    const loose = await Student.findOne({
      employeeId: new RegExp('^\\s*' + employeeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i')
    });
    if (loose) return loose;
  }

  return null;
}

async function requireStudent(req, res, next) {
  try {
    const ses = (sessionOf(req) || {}).student;
    if (!ses) {
      return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
    }

    const student = await findSessionStudent(req);
    if (!student) {
      // The session points at an account that no longer exists — drop it.
      if (req.session) req.session.student = null;
      return res.status(401).json({ success: false, message: 'Session is no longer valid. Please sign in again.' });
    }

    // Self-heal: write back the identifiers we actually matched on, so the next
    // request takes the fast exact path and the loop cannot start again.
    if (req.session && req.session.student) {
      const trueId = student.employeeId || '';
      if (trueId && req.session.student.employeeId !== trueId) {
        console.warn('[auth] repaired session employeeId %j -> %j',
          req.session.student.employeeId, trueId);
        req.session.student.employeeId = trueId;
      }
      if (!req.session.student._id) req.session.student._id = String(student._id);
    }

    req.student = student;
    next();
  } catch (err) {
    console.error('[auth] requireStudent failed:', err.message);
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
}

/**
 * HR staff, or an admin.
 *
 * This used to require `session.hr` alone, while every other HR endpoint in
 * server.js gates on isHRSession(), which accepts `session.hr` OR
 * `session.adminUser`. The HR portal therefore answered inconsistently to the
 * same signed-in person: the dashboard counts loaded, and the Pending
 * Documents call beside them returned 401 with nothing shown to explain it.
 * An admin can do anything HR can, so both guards now agree.
 */
function requireHR(req, res, next) {
  const session = sessionOf(req);
  const hrUser = session && (session.hr || session.adminUser);
  if (!hrUser) {
    // Say WHY, in the log and in the response.
    //
    // A bare "HR sign-in required." is indistinguishable between "the cookie
    // never arrived", "the session expired", and "you are signed in as a
    // student" — three problems with three different fixes. Chasing one of
    // these through the browser console cost real time, so the server now
    // states which it is. No secrets are revealed: only which kind of session
    // the request carried.
    const reason = !session ? 'no session on request'
      : !req.headers.cookie ? 'request carried no cookie header'
      : session.student ? 'signed in as a student, not HR'
      : session.coordinator ? 'signed in as a coordinator, not HR'
      : 'session exists but holds no HR or admin identity (expired or signed out)';
    console.warn(`[auth] requireHR rejected ${req.method} ${req.originalUrl}: ${reason}`);
    return res.status(401).json({
      success: false,
      message: 'HR sign-in required.',
      reason
    });
  }
  req.hrUser = hrUser;
  next();
}

function requireCoordinator(req, res, next) {
  const session = sessionOf(req);
  if (!session || !session.coordinator) {
    return res.status(401).json({ success: false, message: 'Coordinator sign-in required.' });
  }
  req.coordinator = session.coordinator;
  next();
}

/**
 * Coordinators and HR both review student work; an admin session may do
 * anything either can.
 */
function requireStaff(req, res, next) {
  const session = sessionOf(req);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Staff sign-in required.' });
  }
  if (session.coordinator) req.coordinator = session.coordinator;
  if (session.hr) req.hrUser = session.hr;
  if (session.coordinator || session.hr || session.adminUser) return next();
  return res.status(401).json({ success: false, message: 'Staff sign-in required.' });
}

/**
 * Guard for a route that takes an employeeId in the path or body: confirm the
 * caller is that student, or is staff acting on their behalf. Use this instead
 * of trusting the identifier the client supplied.
 */
function requireSelfOrStaff(getTargetEmployeeId) {
  return function selfOrStaffGuard(req, res, next) {
    const session = sessionOf(req);
    if (session && (session.coordinator || session.hr || session.adminUser)) return next();

    const mine = sessionEmployeeId(req);
    if (!mine) {
      return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
    }
    const target = String(getTargetEmployeeId(req) || '');
    if (target && target !== mine) {
      return res.status(403).json({ success: false, message: 'You can only access your own records.' });
    }
    next();
  };
}

module.exports = {
  sessionEmployeeId,
  requireStudent,
  requireHR,
  requireCoordinator,
  findSessionStudent,
  requireStaff,
  requireSelfOrStaff
};
