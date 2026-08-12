"use strict";

/**
 * One place that answers: when a student's record changes, what else has to
 * change with it?
 *
 * A Student document carries several fields that other parts of the product
 * *derive* state from rather than read directly:
 *
 *   tenure               → v2DurationType, internshipEndDate, how many weeks of
 *                          tasks the Task Journey shows, the attendance day
 *                          target, and what the offer letter claims
 *   domain               → which DomainTask set is assigned, which chat room
 *                          the student belongs to, which coordinator sees them,
 *                          and the domain leaderboard
 *   joiningDate /
 *   internshipStartDate  → internshipEndDate and every attendance calculation
 *
 * Before this module, each write path decided for itself how much of that to
 * update. The admin panel did it thoroughly; the HR portal's PUT /students/:id
 * wrote `tenure` alone. So HR extending a student from 1 Month to 3 Months
 * changed the record and nothing else: the Task Journey kept showing four
 * weeks, because task rows are assigned once and never revisited.
 *
 * Every write path now calls propagateStudentChange() after saving. Adding a
 * new field with downstream meaning means adding it here once, rather than
 * remembering to update each caller — see docs/data-propagation.md.
 *
 * Nothing in here is allowed to throw into the caller's response path: a
 * failed notification must not turn a successful save into a 500. Failures are
 * logged and reported in the returned `warnings` array.
 */

const Student   = require("../models/Student");
const taskEngine = require("./v2/taskEngine");
const { normalizeTenure, getTenureLabel, getInternshipEndDate } = require("../utils/tenure");
const { normalizeDomain } = require("../config/domains");

/** Fields whose change has consequences elsewhere in the product. */
const COUPLED_FIELDS = ["tenure", "domain", "joiningDate", "internshipStartDate"];

function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) {
    const ta = a ? new Date(a).getTime() : null;
    const tb = b ? new Date(b).getTime() : null;
    return ta === tb;
  }
  return String(a == null ? "" : a) === String(b == null ? "" : b);
}

/**
 * Canonicalise a patch before it is written.
 *
 * Both HR and admin edit the same fields, and both used to accept whatever
 * string was typed. "3 months", "3 Month" and "3 Months" are the same tenure to
 * a human and three different values to `TENURE_DAYS`, which is how a student
 * ends up with a tenure no lookup table recognises. Normalising at the door
 * means the stored value always round-trips.
 *
 * Returns { patch, error } — `error` is a human-readable message when a value
 * cannot be recognised, so the caller can 400 with something useful.
 */
/**
 * The half of normalisation that needs no database.
 *
 * Kept separate so a caller can reject "2 Months" or a misspelled domain
 * before it loads anything — a validation failure should not depend on the
 * database being reachable, and returning 500 for a value we already know is
 * invalid tells the person at the keyboard nothing useful.
 */
function validateCoreValues(patch) {
  const out = { ...patch };

  if (out.domain !== undefined) {
    const canonical = normalizeDomain(out.domain);
    if (!canonical) {
      return { values: null, error: `Unknown domain: "${out.domain}". Pick one of the listed domains.` };
    }
    out.domain = canonical;
  }

  if (out.tenure !== undefined) {
    const durationType = normalizeTenure(out.tenure);
    if (!durationType) {
      return { values: null, error: `Unknown tenure: "${out.tenure}". Use 1 Week, 15 Days, 1 Month, 45 Days, 3 Months or 6 Months.` };
    }
    out.tenure = getTenureLabel(durationType);
    // The Task Journey reads durationType. Writing tenure without it is what
    // let the two drift apart.
    out.v2DurationType = durationType;
  }

  return { values: out, error: null };
}

function normalizeCorePatch(patch, existing) {
  const { values: out, error } = validateCoreValues(patch);
  if (error) return { patch: null, error };

  // Whenever the tenure or the start date moves, the end date follows.
  const tenureMoved = out.tenure !== undefined;
  const startMoved  = out.joiningDate !== undefined || out.internshipStartDate !== undefined;
  if (tenureMoved || startMoved) {
    const effectiveTenure = out.tenure !== undefined ? out.tenure : (existing && existing.tenure);
    const effectiveStart  = out.internshipStartDate || out.joiningDate
      || (existing && (existing.internshipStartDate || existing.joiningDate || existing.createdAt));
    if (effectiveTenure && effectiveStart) {
      const end = getInternshipEndDate(effectiveStart, effectiveTenure);
      if (end) out.internshipEndDate = end;
    }
  }

  return { patch: out, error: null };
}

/**
 * Apply every downstream consequence of a change that has already been saved.
 *
 * @param {object}  opts
 * @param {object}  opts.student  the student AFTER the write
 * @param {object}  opts.before   a snapshot of the coupled fields BEFORE it
 * @param {string}  opts.actor    who made the change, for the audit trail
 * @param {boolean} opts.notify   send the student a notification (default true)
 */
async function propagateStudentChange({ student, before = {}, actor = "system", notify = true }) {
  const report = {
    changed: [],
    tasks: null,
    offerLetterStale: false,
    notified: false,
    warnings: []
  };

  if (!student) return report;

  for (const field of COUPLED_FIELDS) {
    if (before[field] !== undefined && !sameValue(before[field], student[field])) {
      report.changed.push(field);
    }
  }
  if (!report.changed.length) return report;

  const tenureChanged = report.changed.includes("tenure");
  const domainChanged = report.changed.includes("domain");

  // 1. The Task Journey. This is the one HR reported: the record said 3 Months
  //    and the journey still showed the 1-Month set.
  if (tenureChanged || domainChanged) {
    try {
      report.tasks = await taskEngine.resyncTasksForStudent(student);
    } catch (err) {
      report.warnings.push(`Task journey could not be resynced: ${err.message}`);
      console.error("[propagation] task resync failed:", err.message);
    }
  }

  // 2. An already-issued offer letter states the old domain/tenure in its PDF.
  //    Nothing can rewrite a generated PDF in place, so surface it instead of
  //    letting the record and the document quietly disagree.
  if (tenureChanged || domainChanged) {
    report.offerLetterStale = !!student.offerPdfBase64 ||
      ["issued", "approved"].includes(student.offerLetterStatus);
  }

  // 3. Tell the student. A tenure or domain change alters what they owe and
  //    what they see; finding out by noticing new weeks appear is not good
  //    enough.
  if (notify && student.employeeId) {
    try {
      await notifyStudent(student, report, actor);
      report.notified = true;
    } catch (err) {
      report.warnings.push(`Student notification failed: ${err.message}`);
      console.error("[propagation] notify failed:", err.message);
    }
  }

  return report;
}

async function notifyStudent(student, report, actor) {
  // Required lazily: server.js defines broadcastNotification and requiring it
  // at module load would create a cycle back through server.js.
  const Notification = require("../models/Notification");
  const { broadcastNotification } = require("../utils/sseHub");

  const parts = [];
  if (report.changed.includes("tenure")) parts.push(`your internship duration is now ${student.tenure}`);
  if (report.changed.includes("domain")) parts.push(`your domain is now ${student.domain}`);
  if (report.changed.includes("joiningDate") || report.changed.includes("internshipStartDate")) {
    parts.push("your internship start date was updated");
  }
  if (!parts.length) return;

  let message = `Your internship record was updated — ${parts.join(", ")}.`;
  if (report.tasks && report.tasks.added) {
    message += ` ${report.tasks.added} new task${report.tasks.added === 1 ? "" : "s"} ${report.tasks.added === 1 ? "is" : "are"} now in your Task Journey.`;
  }
  if (report.tasks && report.tasks.removed) {
    message += ` ${report.tasks.removed} task${report.tasks.removed === 1 ? "" : "s"} no longer in your plan ${report.tasks.removed === 1 ? "was" : "were"} removed.`;
  }

  const notif = new Notification({
    title: "Internship details updated",
    message,
    type: "info",
    from: actor || "TEN",
    targetType: "student",
    targetEmployeeId: student.employeeId,
    targetDomain: student.domain
  });
  await notif.save();
  broadcastNotification(student.domain, student.employeeId, notif);
}

/**
 * Convenience wrapper for the common shape: snapshot, write, propagate.
 *
 * Callers that already hold the student document can use the two functions
 * directly; this exists so a route handler does not have to remember the
 * order of operations.
 */
async function updateStudentAndPropagate({ studentId, patch, actor = "system", notify = true }) {
  // Validate first, load second. An unrecognised tenure is knowable without
  // the database, and answering it with a 400 rather than whatever the
  // database happened to do keeps the message useful when Mongo is degraded.
  const { error: invalid } = validateCoreValues(patch);
  if (invalid) return { student: null, report: null, error: invalid, notFound: false };

  const existing = await Student.findById(studentId);
  if (!existing) return { student: null, report: null, error: null, notFound: true };

  const { patch: normalized, error } = normalizeCorePatch(patch, existing);
  if (error) return { student: null, report: null, error, notFound: false };

  const before = {};
  for (const field of COUPLED_FIELDS) before[field] = existing[field];

  const student = await Student.findByIdAndUpdate(studentId, { $set: normalized }, { new: true });
  const report  = await propagateStudentChange({ student, before, actor, notify });

  return { student, report, error: null, notFound: false, applied: normalized, before };
}

module.exports = {
  COUPLED_FIELDS,
  validateCoreValues,
  normalizeCorePatch,
  propagateStudentChange,
  updateStudentAndPropagate
};
