'use strict';

/**
 * One review path for a submission, whoever decides.
 *
 * The coordinator's Approve button (POST /update-status) and the AI
 * Coordinator's reviews of clear cases (services/aiCoordinatorJobs.js) both
 * go through reviewSubmission() in server.js, so the student's notice, the
 * Task Journey, milestones, the certificate check and badges happen the same
 * way for both, and a decision is written only once: a coordinator and the AI
 * acting in the same second cannot both decide.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SERVER = read('server.js');

describe('reviewSubmission() in server.js', () => {
    const fn = SERVER.slice(SERVER.indexOf('async function reviewSubmission('), SERVER.indexOf('app.post("/update-status"'));

    it('writes the decision with one conditional update, never after a read', () => {
        expect(fn).toContain('const existing = await Submission.findOneAndUpdate(Object.assign({ _id: id }, open), {');
        expect(fn).not.toContain('findByIdAndUpdate');
        expect(fn).toContain('reviewedBy,');
        expect(fn).toMatch(/alreadyReviewed:true/);
    });

    it('lets a person change the AI\'s decision, and the AI change nobody\'s', () => {
        expect(fn).toContain('const open = reviewedBy === "ai" ? { reviewedOnce: { $ne: true } } : { $or: [{ reviewedOnce: { $ne: true } }, { reviewedBy: "ai" }] };');
    });

    it('only approves or rejects, and signs the student\'s notice with who decided', () => {
        expect(fn).toContain('if (status !== "Approved" && status !== "Rejected") return { success:false');
        expect(fn).toMatch(/from,\s*targetType: "student"/);
    });

    it('is what the route and the AI Coordinator both call', () => {
        const route = SERVER.slice(SERVER.indexOf('app.post("/update-status"'), SERVER.indexOf('app.post("/update-status"') + 400);
        expect(route).toContain('res.json(await reviewSubmission({ id, status, feedback, rating }));');
        expect(SERVER).toContain('require("./services/aiCoordinatorJobs").attach({ review: reviewSubmission, certificate: { criteria: certificateCriteria, approve: approveForCertificate } });');
        expect(SERVER).toMatch(/reviewedBy: \{ type: String, default: "" \}/);
        // On every worker, not only the cron worker: a hand-in is decided on the worker that took it.
        expect(SERVER.indexOf('require("./services/aiCoordinatorJobs").attach(')).toBeLessThan(SERVER.indexOf('require("./services/aiCoordinatorJobs").start();'));
    });

    it('a student\'s hand-in and resubmission are decided right after their pre-check', () => {
        expect(SERVER).toContain('require("./services/submissionPrecheck").run(submission._id, { review: true })');
        expect(read('routes/v2/studentPortal.js')).toContain('.run(legSub._id, { screenshotExpected: false, review: true })');
    });
});

describe('the certificate approval has one path too', () => {
    const route = SERVER.slice(SERVER.indexOf('app.post("/students/:id/coordinator-approve"'), SERVER.indexOf('app.post("/students/:id/coordinator-revoke"'));

    it('the Students tab\'s button and the AI both call approveForCertificate()', () => {
        expect(route).toContain('await approveForCertificate(student, { approver, remarks });');
        expect(SERVER).toContain('async function approveForCertificate(student, { approver = "coordinator", remarks = "", from = "Coordinator", message } = {})');
    });

    it('the criteria are the ones the certificateEligible milestone already used', () => {
        const crit = SERVER.slice(SERVER.indexOf('async function certificateCriteria('), SERVER.indexOf('app.post("/students/:id/coordinator-approve"'));
        expect(crit).toContain('ok: attendance >= 75 && approvedTasks >= 5');
        const elig = SERVER.slice(SERVER.indexOf('async function checkCertificateEligibility('), SERVER.indexOf('async function checkCertificateEligibility(') + 400);
        expect(elig).toContain('if((await certificateCriteria(s)).ok){');
    });

    it('the Students tab shows who approved', () => {
        expect(SERVER).toMatch(/approvedByCoordinatorId: s\.approvedByCoordinatorId,/);
        expect(read('public/coordinator-dashboard.html')).toContain('s.approvedByCoordinatorId === "TEN AI Coordinator"');
    });
});

describe('an AI review is labelled as the AI\'s', () => {
    it('on the coordinator\'s card, which keeps its Approve and Reject buttons', () => {
        const src = read('public/coordinator-dashboard.html');
        expect(src).toContain('${isReviewed && sub.reviewedBy !== "ai"');
        expect(src).toContain('🤖 The AI Coordinator decided: ${sub.status}. The student can submit again and it is checked afresh; you can change the decision below, and yours is then final.');
        expect(src).toContain('sub.reviewedBy === "ai" ? "AI Coordinator Feedback" : "Coordinator Feedback"');
    });

    it('on the student\'s card, with the way to change it', () => {
        const src = read('public/student-dashboard.html');
        expect(src).toContain("sub.reviewedBy === 'ai' ? '🤖 AI COORDINATOR FEEDBACK' : '📝 COORDINATOR FEEDBACK'");
        expect(src).toContain('Fix what it asks and submit the task again: the AI checks it again straight away.');
    });
});
