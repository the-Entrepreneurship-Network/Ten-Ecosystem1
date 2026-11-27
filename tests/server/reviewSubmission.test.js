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
        expect(fn).toContain('Submission.findOneAndUpdate({ _id: id, reviewedOnce: { $ne: true } }, {');
        expect(fn).not.toContain('findByIdAndUpdate');
        expect(fn).toContain('reviewedBy,');
        expect(fn).toMatch(/alreadyReviewed:true/);
    });

    it('only approves or rejects, and signs the student\'s notice with who decided', () => {
        expect(fn).toContain('if (status !== "Approved" && status !== "Rejected") return { success:false');
        expect(fn).toMatch(/from,\s*targetType: "student"/);
    });

    it('is what the route and the AI Coordinator both call', () => {
        const route = SERVER.slice(SERVER.indexOf('app.post("/update-status"'), SERVER.indexOf('app.post("/update-status"') + 400);
        expect(route).toContain('res.json(await reviewSubmission({ id, status, feedback, rating }));');
        expect(SERVER).toContain('aiJobs.attach({ review: reviewSubmission });');
        expect(SERVER).toMatch(/reviewedBy: \{ type: String, default: "" \}/);
    });
});

describe('an AI review is labelled as the AI\'s', () => {
    it('on the coordinator\'s card', () => {
        const src = read('public/coordinator-dashboard.html');
        expect(src).toContain('sub.reviewedBy === "ai" ? "🤖 Reviewed by the AI Coordinator" : "🔒 Already reviewed"');
        expect(src).toContain('sub.reviewedBy === "ai" ? "AI Coordinator Feedback" : "Coordinator Feedback"');
    });

    it('on the student\'s card', () => {
        expect(read('public/student-dashboard.html')).toContain("sub.reviewedBy === 'ai' ? '🤖 AI COORDINATOR FEEDBACK' : '📝 COORDINATOR FEEDBACK'");
    });
});
