const mongoose = require("mongoose");

const studentsSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    name: String,
    domain: String,
    domains: [String],
    whatsapp: String,
    email: String,
    collegeName: { type: String, default: "" },
    college: { type: String, default: "" },
    tenure: String,
    dualDomains: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0 },
    // When the most recent failure was. Without it the attempt counter never
    // decayed: five mistyped passwords spread over months added up to a
    // lockout, and the student had no idea why. See recordFailedAttempt.
    lastFailedLoginAt:   { type: Date, default: null },
    lockoutUntil: { type: Date, default: null },
    isLockedOut: { type: Boolean, default: false },
    joiningDate: String,
    employeeId: { type: String, unique: true, sparse: true },
    // Always a bcrypt hash. There is deliberately no default: an account
    // without a password must fail to authenticate, not fall back to a shared
    // well-known one.
    //
    // NOTE: a `plainPassword` field used to sit here holding the cleartext
    // password alongside this hash, refreshed on every successful login and
    // readable through an unauthenticated endpoint. It has been removed. Do
    // not reintroduce a reversible copy of a password in any form.
    password: {
        type: String,
        required: true
    },

    certificateApprovedByCoordinator: { type: Boolean, default: false },
    approvedByCoordinatorId:          { type: String, default: "" },
    coordinatorRemarks:               { type: String, default: "" },

    certificateApprovedByHR:          { type: Boolean, default: false },
    hrApprovedAt:                     { type: Date },
    approvedByHRId:                   { type: String, default: "" },
    hrRemarks:                        { type: String, default: "" },

    hrRejected:                       { type: Boolean, default: false },
    hrRejectionReason:                { type: String, default: "" },

    linkedDomains: [{
        domain:     { type: String, required: true },
        studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
        employeeId: { type: String, required: true }
    }],

    passwordResetToken:   { type: String, default: null, index: true },
    passwordResetExpiry:  { type: Date,   default: null },
    activeSessionToken:   { type: String, default: null },

    // ── Credentials an admin has changed on the student's behalf ────────────
    //
    // When a student cannot get in, an admin can set a working password (and
    // correct a wrong email) so they can sign in again. That hands the admin a
    // password the student did not choose, which is fine as a way back in and
    // not fine as a permanent state — so the account is flagged, and the next
    // sign-in asks the student to set their own before going any further.
    //
    // Two independent flags, because the two changes are independent: an admin
    // may fix a typo in an email without touching the password, or the other
    // way round.
    mustChangePassword:   { type: Boolean, default: false },
    mustChangeEmail:      { type: Boolean, default: false },
    // Context for the student ("your access was reset by TEN Admin on …"), and
    // an audit trail on the record itself. Never the password, in any form.
    credentialResetAt:    { type: Date,   default: null },
    credentialResetBy:    { type: String, default: null },
    // What the email was before the admin corrected it, so a mistake can be
    // traced and so the student can see what changed.
    previousEmail:        { type: String, default: null },

    currentStreak:        { type: Number, default: 0 },
    bestStreak:           { type: Number, default: 0 },
    lastAttendanceDate:   { type: Date },
    lastActiveDate:       { type: Date },

    milestones: {
        firstAttendance:        { type: Date },
        firstTaskSubmitted:     { type: Date },
        firstTaskApproved:      { type: Date },
        reached50Attendance:    { type: Date },
        reached75Attendance:    { type: Date },
        certificateEligible:    { type: Date },
        coordinatorApproved:    { type: Date },
        hrApproved:             { type: Date },
        certificatesGenerated:  { type: Date },
        internshipCompleted:    { type: Date }
    },

    reminderEmailsSent: {
        type: Map,
        of: Date,
        default: {}
    },
    certificateEligibilityEmailSent: { type: Boolean, default: false },

    documentsAutoSent:    { type: Boolean, default: false },
    documentsAutoSentAt:  { type: Date },
    autoDocUniqueId:      { type: String, default: "" },
    documentVerified:     { type: Boolean, default: false },
    documentVerifiedAt:   { type: Date },
    documentNumber:       { type: String, default: "" },

    // FEATURE 1 — Onboarding popup shown only once
    onboardingPopupSeen:  { type: Boolean, default: false },

    // FEATURE 1 — Joiner type popup shown only once
    joinerTypeSelected:   { type: Boolean, default: false },
    joinerType:           { type: String, enum: ['new', 'whatsapp', null], default: null },

    /*
     * Every time HR has sent this student back through the joiner wizard.
     *
     * A student who picks "WhatsApp joiner" by mistake cannot undo it — the
     * choice back-dates their internship and credits attendance they did not
     * mark. HR (level 3 and up) resets it, the wizard shows once more, and
     * this row says who did it and what the wrong answer had been. Kept as
     * history rather than a flag so a second reset is simply a second row.
     */
    onboardingResets: [{
        at:       { type: Date, default: Date.now },
        by:       { type: String, default: "" },   // HR name or email
        byLevel:  { type: Number, default: null },
        reason:   { type: String, default: "" },
        previous: {
            joinerType:          { type: String, default: null },
            internshipStartDate: { type: Date,   default: null },
            calculatedAttendance:{ type: Number, default: null }
        }
    }],

    /*
     * The two dates HR corrected on a generated document, per document type.
     *
     * Per type on purpose: a Letter of Completion and an Offer Letter describe
     * different spans, and one shared pair would make correcting either one
     * silently rewrite the other. Anything not overridden is derived — see
     * services/certificateDates.js, which is the only thing that reads this.
     *
     * Only the dates. Everything else on a generated document is a fact the
     * portal measured, and is not HR's to retype.
     */
    certificateDates: {
        type: Map,
        of: new mongoose.Schema({
            start:      { type: Date,   default: null },
            end:        { type: Date,   default: null },
            setBy:      { type: String, default: "" },
            setByLevel: { type: Number, default: null },
            at:         { type: Date,   default: Date.now }
        }, { _id: false }),
        default: undefined
    },

    employeeIdOverride:  { type: String, default: null },

    // For a WhatsApp joiner this is deliberately EARLIER than joiningDate:
    // they attended through WhatsApp before they had a portal account. The
    // attendance calculation credits that pre-portal stretch as attended,
    // because no daily records can exist for days before the student was in
    // the system.
    internshipStartDate: { type: Date, default: null },

    // Coordinator override for the pre-portal period above. If a WhatsApp
    // joiner actually missed some of those days, set the count here and it is
    // deducted from the credited total.
    preportalAbsentDays: { type: Number, default: 0 },

    /*
     * A pre-portal claim that reaches back past the whole tenure — the
     * internship would have finished before the account existed. Possible in
     * real life, and also what somebody types to be handed a full attendance
     * record for nothing. The claim is stored and counts for zero until HR
     * confirms it; see services/attendanceUtils getPreportalCreditedDays.
     */
    /*
     * When the joiner wizard was finished — the ONE field that means that.
     *
     * The guard on this endpoint used to read v2Onboarded, and v2Onboarded
     * belongs to a different feature: ensureOnboarded() sets it on
     * GET /student/status, which the dashboard calls on every page load. So it
     * was already true by the time any student reached the joining-date card,
     * and the guard refused all of them. Nothing else writes this one, and
     * services/onboardingReset.js clears it.
     */
    joinerWizardCompletedAt: { type: Date, default: null },

    /*
     * What this student's completion percentage was before their track grew.
     *
     * The 1-week, 15-day, 1-month and 45-day tracks were lengthened (1 task
     * became 4, 4 became 8, and so on). A student halfway through one of them
     * had done, say, 4 of 4 — and would have woken up at 4 of 8 through no act
     * of their own, which can drop them under the 50% an LOR requires.
     *
     * Set once, by scripts/expand-task-tracks.js, and only when the number
     * actually fell. Anything that gates on completion reads the better of this
     * and the live figure, so nobody loses standing they had already reached.
     * Their real progress still counts up from where it is.
     */
    preExpansionCompletionPercent: { type: Number, default: null },
    trackExpandedAt:               { type: Date,   default: null },

    preportalCreditNeedsReview:  { type: Boolean, default: false },
    preportalCreditConfirmedAt:  { type: Date,   default: null },
    preportalCreditConfirmedBy:  { type: String, default: "" },

    // Last day of the internship, derived from internshipStartDate/joiningDate
    // and tenure. Kept on the document so the admin panel can extend a tenure
    // and so scheduled jobs can query it — the auto-mark cron queried an
    // `internshipEnd` field that never existed, matching zero students.
    internshipEndDate:   { type: Date, default: null },
    hasSeenWelcome:      { type: Boolean, default: false },
    hasSeenOnboarding:   { type: Boolean, default: false },
    calculatedAttendance: { type: Number, default: null },

    // v2 portal fields
    v2Onboarded:          { type: Boolean, default: false },
    v2DurationType:       { type: String, default: null },

    locPdfBase64:            { type: String, default: null },
    locStatus:               { type: String, enum: ['not_eligible','pending_coordinator','pending_hr','fine_pending','issued'], default: 'not_eligible' },
    locIssuedAt:             { type: Date,   default: null },
      
    lorPdfBase64:            { type: String, default: null },
    lorStatus:               { type: String, enum: ['not_eligible','pending_coordinator','pending_hr','fine_pending','issued'], default: 'not_eligible' },
    lorIssuedAt:             { type: Date,   default: null },
      
    starPdfBase64:           { type: String, default: null },
    starStatus:              { type: String, enum: ['not_submitted','pending_review','approved','issued','rejected'], default: 'not_submitted' },
    starIssuedAt:            { type: Date,   default: null },
    starContribution:        { type: String, default: null },

    // Letter of Promotion (LOP)
    lopPdfBase64:            { type: String, default: null },
    lopStatus:               { type: String, enum: ['not_eligible','pending','issued'], default: 'not_eligible' },
    lopIssuedAt:             { type: Date,   default: null },
    lopOldRole:              { type: String, default: null },
    lopNewRole:              { type: String, default: null },
    lopEffectiveDate:        { type: Date,   default: null },
    lopDepartment:           { type: String, default: null },

    // Issued directly by HR rather than through the application → eligibility →
    // approval path. Interns who did their whole internship over WhatsApp have
    // no portal record to satisfy those checks, so HR issues the certificate
    // itself; the flag is what makes that visible on the student's own page and
    // in the admin portal's override list. The full record — who, when, what
    // was missing — lives in models/CertificateOverride.js.
    locIssuedByOverride:     { type: Boolean, default: false },
    lorIssuedByOverride:     { type: Boolean, default: false },
    starIssuedByOverride:    { type: Boolean, default: false },
    offerIssuedByOverride:   { type: Boolean, default: false },
    lopIssuedByOverride:     { type: Boolean, default: false },

    // Gender — drives correct pronouns in generated documents.
    // Empty / undefined values fall back to neutral "they/them/their".
    gender:                  { type: String, enum: ['male','female','',null], default: '' },
      
    offerPdfBase64:          { type: String, default: null },
    offerLetterStatus:       { type: String, enum: ['not_uploaded','pending','under_review','approved','rejected','issued'], default: 'not_uploaded' },
    offerLetterGeneratedAt:  { type: Date,   default: null },
    documentRejectionReason: { type: String, default: null },
    documentsSubmittedAt:    { type: Date,   default: null },
      
    attendancePercentage:    { type: Number, default: 0 },
    calculatedAttendancePercentage: { type: Number, default: null },
    attendanceLastCalculated: { type: Date, default: null },
    performanceScore:        { type: Number, default: 0 },
    internshipCompleted:     { type: Boolean, default: false },
    internshipCompletedAt:   { type: Date,   default: null },
    coordinatorApprovedAt:   { type: Date,   default: null },
    coordinatorApprovalStatus: { type: String, enum: ['pending','approved','escalated_to_hr'], default: 'pending' },
      
    pendingFines: [{
      fineType: { type: String },       // 'loc_attendance' | 'lor_criteria'
      amount:   { type: Number },       // 100 or 50
      reason:   { type: String },
      paid:     { type: Boolean, default: false },
      createdAt:{ type: Date, default: Date.now },
    }],
    /**
     * What the paid track's bundle actually handed over, recorded when an admin
     * approves (services/tenureBenefits.js). Kept on the student so the
     * dashboard can show "here is what you just unlocked" without re-deriving
     * it, and so `grantedAt` makes a second grant a no-op.
     */
    tenureBenefits: {
        plan:             { type: String, default: '' },
        durationType:     { type: String, default: '' },
        grantedAt:        { type: Date,   default: null },
        coinsGranted:     { type: Number, default: 0 },
        certificate:      { type: String, default: '' },
        certificateLabel: { type: String, default: '' },
        certificateWaived:{ type: Boolean, default: false },
        valueTotal:       { type: Number, default: 0 },
        perks:            { type: [String], default: [] }
    },

    shortCoursePaid: { type: Boolean, default: false },
    shortCoursePaymentId: { type: String, default: null },
    shortCoursePaymentVerified: { type: Boolean, default: false },
    shortCoursePaymentSkipped: { type: Boolean, default: false }, // for future use
    isExistingStudent: { type: Boolean, default: false }, // set on registration
}, {
    timestamps: true
});

// Indexes for the fields actually queried in bulk.
//
// Only employeeId was indexed, so `Student.findOne({ email })` — the login
// path, and the second most common query in the codebase — did a full
// collection scan of every student on every attempt. `find({ domain })` behind
// the domain leaderboard and the coordinator views did the same.
//
// email is deliberately NOT unique: production may already hold duplicates,
// and a unique index that cannot be built would fail at startup.
studentsSchema.index({ email: 1 });
studentsSchema.index({ domain: 1 });

// Sort keys. These are not an optimisation — without them the HR lists BREAK.
//
// A Student document embeds up to five base64 PDFs (offer letter, LOC, LOR,
// star, promotion), so a single record can be megabytes. An unindexed
// `.sort()` makes MongoDB run a blocking SORT stage over the FETCHED
// documents — PDFs included — and at ~778 students that exceeded the 100MB
// in-memory sort limit and returned:
//
//   Executor error during find command :: caused by ::
//   Sort exceeded memory limit of 104857600 bytes
//
// A projection does not help: the sort happens before it. An index does,
// because the planner then walks the index in order (IXSCAN) and drops the
// blocking sort entirely. This one line fixes every HR list that sorts.
studentsSchema.index({ createdAt: -1 });
studentsSchema.index({ joiningDate: -1 });
studentsSchema.index({ lastActiveDate: -1 });

/* ---------------------------------------------------------------------------
 * The name must never be missing, blank, or the string "undefined".
 *
 * The admin console printed `undefined` in the Name column for a number of
 * students. Two separate things produced that, and both are guarded here
 * rather than at the call sites, because there are three places that create a
 * Student and more than twenty that update one:
 *
 *   1. A document whose `name` was never set. `name: String` has no default,
 *      so the field is simply absent, the API omits it, and the page prints
 *      the JavaScript `undefined`.
 *   2. A document whose `name` was set to the literal text "undefined". The
 *      admin Edit form was pre-filled from the value the table had just
 *      rendered, so opening a broken row and pressing Save wrote the word
 *      into the database permanently. That is why this spread.
 *
 * `firstName` and `lastName` are set by every registration path, so they are
 * the first fallback; the email local part is the last resort and is still
 * better than a row nobody can identify.
 * ------------------------------------------------------------------------- */

/** Values that look like a name but are not one. */
const NOT_A_NAME = new Set(["undefined", "null", "nan", "-", "—"]);

function isUsableName(value) {
    if (typeof value !== "string") return false;
    const t = value.trim();
    return t.length > 0 && !NOT_A_NAME.has(t.toLowerCase());
}

/** Best available human name for a student, or "" when there is nothing. */
function deriveStudentName({ name, firstName, lastName, email } = {}) {
    if (isUsableName(name)) return name.trim();

    const parts = [firstName, lastName].filter(isUsableName).map(s => s.trim());
    if (parts.length) return parts.join(" ");

    // Last resort: the email local part, tidied. "kanishka.sharma05" reads as
    // "Kanishka Sharma05" — imperfect, but identifiable, which is the point.
    if (typeof email === "string" && email.includes("@")) {
        const local = email.split("@")[0].replace(/[._\-+]+/g, " ").trim();
        if (local) return local.replace(/\b\w/g, c => c.toUpperCase());
    }
    return "";
}

/** Give a document being saved the best name available. */
function applyNameToDoc(doc) {
    const resolved = deriveStudentName(doc);
    if (resolved && resolved !== doc.name) doc.name = resolved;
    return doc;
}

/**
 * Sanitise an update before it is written. Two jobs: never let "undefined" be
 * written as a name, and keep `name` in step when a caller updates only
 * firstName/lastName.
 */
function applyNameToUpdate(update) {
    if (!update || Array.isArray(update)) return update;

    const set = update.$set || update;
    const touches = ["name", "firstName", "lastName"].some(k => set[k] !== undefined);
    if (!touches) return update;

    if (set.name !== undefined && !isUsableName(set.name)) {
        // A caller explicitly tried to write a junk name. Drop the write rather
        // than persist it; the existing value is better than "undefined".
        delete set.name;
    }
    if (set.name === undefined && (set.firstName !== undefined || set.lastName !== undefined)) {
        const resolved = deriveStudentName({ firstName: set.firstName, lastName: set.lastName });
        if (resolved) set.name = resolved;
    }
    return update;
}

studentsSchema.pre("save", function (next) {
    applyNameToDoc(this);
    next();
});

studentsSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
    applyNameToUpdate(this.getUpdate());
    next();
});

module.exports = mongoose.model("Student", studentsSchema);
module.exports.deriveStudentName = deriveStudentName;
module.exports.isUsableName = isUsableName;
module.exports.applyNameToDoc = applyNameToDoc;
module.exports.applyNameToUpdate = applyNameToUpdate;
