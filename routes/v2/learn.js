'use strict';

/**
 * The LLM portal — TEN's learning portal. One module per domain, a hard
 * sequence inside each: read the module → watch its video → sit its exam.
 * Camera-proctored exams, AI-set and AI-marked papers, an HR hold after three
 * proctor warnings, a two-hour final, an optional big project, a certificate.
 *
 * Accounts here are EcosystemUser rows with role "learner" — the portal was
 * asked for with its own sign-up, and a learner is not an intern: no employee
 * id, no tenure, no attendance. Payment rides the existing Studio pipeline
 * (config/studioPricing "course" product), so the pay screen, the UPI QR, the
 * admin approval queue and pay-after-completion all come for free.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const curriculum = require('../../config/learnCurriculum');
const learnExam = require('../../services/learnExam');
const studioAccess = require('../../services/studioAccess');

const WARN_LIMIT = 3;

// ── who is asking ───────────────────────────────────────────────────────────

function sessionLearner(req) {
    return (req.session && req.session.learner) || null;
}

function requireLearner(handler) {
    return async (req, res) => {
        try {
            const who = sessionLearner(req);
            if (!who) return res.status(401).json({ success: false, message: 'Please sign in to the LLM portal.' });
            return await handler(req, res, who);
        } catch (err) {
            console.error('[learn] ' + req.path + ':', err.message);
            return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
        }
    };
}

function requireHR(handler) {
    return async (req, res) => {
        try {
            if (!req.session || (!req.session.hr && !req.session.adminUser)) {
                return res.status(401).json({ success: false, message: 'HR sign-in required.' });
            }
            return await handler(req, res);
        } catch (err) {
            console.error('[learn:hr] ' + req.path + ':', err.message);
            return res.status(500).json({ success: false, message: 'Something went wrong.' });
        }
    };
}

/** The shape studioAccess expects. A learner has no tenure and no employeeId,
 *  which correctly makes them "not premium" — they pay, or defer. */
function accessSubject(who) {
    return { _id: who.id, employeeId: null, tenure: null, email: who.email, name: who.name };
}

/**
 * Course access for whoever is signed in — checked against BOTH identities the
 * same person can hold.
 *
 * An intern who upgrades buys through the Studio while signed into the intern
 * portal, so their Payment row carries their Student id; when they later sign
 * into the Academic Portal, the session carries their EcosystemUser id. Same
 * person, two ids — matched here by email, or the upgrade they paid for would
 * open nothing. A paid internship track rides in the same way, because the
 * Student row is what carries the tenure.
 */
async function courseAccessFor(who) {
    const direct = await studioAccess.getStudioAccess(accessSubject(who));
    if (direct.portals.course.granted) return direct;
    try {
        const Student = require('../../models/Student');
        const twin = await Student.findOne({ email: String(who.email || '').toLowerCase() }).lean();
        if (twin) {
            const viaStudent = await studioAccess.getStudioAccess(twin);
            if (viaStudent.portals.course.granted) return viaStudent;
        }
    } catch (err) {
        console.error('[learn] twin-account lookup failed:', err.message);
    }
    return direct;
}

// ── accounts ────────────────────────────────────────────────────────────────

router.post('/signup', async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || '').trim();
        const email = String((req.body && req.body.email) || '').trim().toLowerCase();
        const password = String((req.body && req.body.password) || '');
        if (name.length < 2) return res.status(400).json({ success: false, message: 'Please give your name.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            return res.status(400).json({ success: false, message: 'That does not look like an email address.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Use a password of at least 8 characters.' });
        }

        const EcosystemUser = require('../../models/EcosystemUser');
        const existing = await EcosystemUser.findOne({ email }).select('_id role').lean();
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'An account already exists for this address — sign in instead.'
            });
        }

        const user = await EcosystemUser.create({
            role: 'learner',
            fullName: name,
            email,
            password: await bcrypt.hash(password, 10),
            isVerified: true,
            isActive: true
        });

        req.session.learner = { id: String(user._id), name, email };
        return res.status(201).json({ success: true, name, email });
    } catch (err) {
        console.error('[learn] signup:', err.message);
        return res.status(500).json({ success: false, message: 'Could not create the account. Please try again.' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const email = String((req.body && req.body.email) || '').trim().toLowerCase();
        const password = String((req.body && req.body.password) || '');
        const EcosystemUser = require('../../models/EcosystemUser');
        const user = await EcosystemUser.findOne({ email });
        // One answer for a missing account and a wrong password: this endpoint
        // must not confirm which addresses have accounts.
        const BAD = { success: false, message: 'Email or password is incorrect.' };
        if (!user || !user.isActive) return res.status(401).json(BAD);
        const ok = await bcrypt.compare(password, user.password || '');
        if (!ok) return res.status(401).json(BAD);

        req.session.learner = { id: String(user._id), name: user.fullName, email: user.email };
        return res.json({ success: true, name: user.fullName, email: user.email });
    } catch (err) {
        console.error('[learn] login:', err.message);
        return res.status(500).json({ success: false, message: 'Could not sign you in. Please try again.' });
    }
});

router.post('/logout', (req, res) => {
    if (req.session) delete req.session.learner;
    res.json({ success: true });
});

router.get('/me', requireLearner(async (req, res, who) => {
    const access = await courseAccessFor(who);
    res.json({
        success: true, name: who.name, email: who.email,
        courseOpen: access.portals.course.granted,
        via: access.portals.course.via,
        feeDue: access.feeDue
    });
}));

// ── the curriculum ──────────────────────────────────────────────────────────

const LearnProgress = () => require('../../models/LearnProgress');

async function progressFor(who, slug) {
    return LearnProgress().findOneAndUpdate(
        { userId: who.id, domainSlug: slug },
        { $setOnInsert: { topics: [] } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
}

function topicState(progress, n) {
    return progress.topics.find((t) => t.n === n) || null;
}

/** A topic is open when every earlier one is settled — passed, or closed by an
 *  HR rejection, which by the spec moves the learner along. */
function firstUnsettled(mod, progress) {
    for (const t of mod.topics) {
        const st = topicState(progress, t.n);
        if (!st || (!st.passedAt && !st.closedByHRAt)) return t.n;
    }
    return mod.topics.length + 1;   // everything settled → the final is open
}

router.get('/curriculum', requireLearner(async (req, res, who) => {
    const access = await courseAccessFor(who);
    const mine = await LearnProgress().find({ userId: who.id }).lean();
    const bySlug = Object.fromEntries(mine.map((p) => [p.domainSlug, p]));

    res.json({
        success: true,
        courseOpen: access.portals.course.granted,
        via: access.portals.course.via,
        feeDue: access.feeDue,
        modules: curriculum.getModules().map((m) => {
            const p = bySlug[m.slug];
            const settled = p ? p.topics.filter((t) => t.passedAt || t.closedByHRAt).length : 0;
            return {
                slug: m.slug, name: m.name, shortCode: m.shortCode,
                ready: m.ready, topicCount: m.topics.length,
                settled,
                finalPassed: !!(p && p.finalExam && p.finalExam.passedAt),
                certificateId: (p && p.certificateId) || null
            };
        })
    });
}));

router.get('/module/:slug', requireLearner(async (req, res, who) => {
    const mod = curriculum.getModule(req.params.slug);
    if (!mod || !mod.ready) return res.status(404).json({ success: false, message: 'No such module.' });

    const access = await courseAccessFor(who);
    if (!access.portals.course.granted) {
        return res.status(402).json({ success: false, payRequired: true,
            message: 'The course is not unlocked yet.' });
    }

    const progress = await progressFor(who, mod.slug);
    const open = firstUnsettled(mod, progress);
    const ProctorIncident = require('../../models/ProctorIncident');
    const hold = await ProctorIncident.findOne({ userId: who.id, domainSlug: mod.slug, status: 'pending' })
        .select('topicN createdAt').lean();

    res.json({
        success: true,
        slug: mod.slug, name: mod.name,
        // Titles and states only — module text is fetched per topic, once it is open.
        topics: mod.topics.map((t) => {
            const st = topicState(progress, t.n);
            return {
                n: t.n, title: t.title, difficulty: t.difficulty,
                open: t.n <= open,
                readAt: st && st.readAt, videoDoneAt: st && st.videoDoneAt,
                passedAt: st && st.passedAt, closedByHR: !!(st && st.closedByHRAt),
                attempts: (st && st.attempts) || 0
            };
        }),
        finalOpen: open > mod.topics.length,
        finalPassed: !!progress.finalExam.passedAt,
        finalClosedByHR: !!progress.finalExam.closedByHRAt,
        project: progress.project,
        certificateId: progress.certificateId,
        proctorHold: hold ? { topicN: hold.topicN, since: hold.createdAt } : null
    });
}));

router.get('/module/:slug/topic/:n', requireLearner(async (req, res, who) => {
    const mod = curriculum.getModule(req.params.slug);
    const n = parseInt(req.params.n, 10);
    const topic = mod && mod.topics[n - 1];
    if (!topic) return res.status(404).json({ success: false, message: 'No such topic.' });

    const access = await courseAccessFor(who);
    if (!access.portals.course.granted) {
        return res.status(402).json({ success: false, payRequired: true, message: 'The course is not unlocked yet.' });
    }
    const progress = await progressFor(who, mod.slug);
    if (n > firstUnsettled(mod, progress)) {
        return res.status(403).json({ success: false, message: 'Finish the earlier topics first — the order is the course.' });
    }

    // Opening the topic IS reading it having begun.
    await LearnProgress().updateOne(
        { _id: progress._id, 'topics.n': { $ne: n } },
        { $push: { topics: { n, readAt: new Date() } } }
    );
    await LearnProgress().updateOne(
        { _id: progress._id, topics: { $elemMatch: { n, readAt: null } } },
        { $set: { 'topics.$.readAt': new Date() } }
    );

    const st = topicState(await progressFor(who, mod.slug), n);
    res.json({
        success: true,
        topic: {
            n, title: topic.title, difficulty: topic.difficulty,
            technical: topic.technical, simple: topic.simple,
            videoId: topic.videoId, videoSearch: topic.videoSearch
        },
        videoDoneAt: st && st.videoDoneAt,
        passedAt: st && st.passedAt,
        closedByHR: !!(st && st.closedByHRAt)
    });
}));

/*
 * The browser attests the video was watched to the end. The server cannot see
 * a screen; what it CAN hold is the claim, the seconds actually played, and
 * the rule that the exam stays shut until this arrives.
 * ponytail: client attestation is the ceiling of web video-watch enforcement —
 * tighten by comparing playedSeconds against the video's real duration if it
 * ever matters enough to store durations.
 */
router.post('/module/:slug/topic/:n/video-done', requireLearner(async (req, res, who) => {
    const mod = curriculum.getModule(req.params.slug);
    const n = parseInt(req.params.n, 10);
    if (!mod || !mod.topics[n - 1]) return res.status(404).json({ success: false });
    const playedSeconds = Number((req.body && req.body.playedSeconds) || 0);
    if (playedSeconds < 60) {
        return res.status(400).json({ success: false, message: 'Watch the video through before moving on.' });
    }
    const progress = await progressFor(who, mod.slug);
    await LearnProgress().updateOne(
        { _id: progress._id, 'topics.n': n },
        { $set: { 'topics.$.videoDoneAt': new Date() } }
    );
    res.json({ success: true });
}));

// ── exams ───────────────────────────────────────────────────────────────────

const Attempt = () => require('../../models/LearnExamAttempt');

/** The one live attempt for (user, domain, topic), if any. */
async function liveAttempt(who, slug, topicN) {
    return Attempt().findOne({
        userId: who.id, domainSlug: slug, topicN,
        submittedAt: null, voidedAt: null,
        deadlineAt: { $gt: new Date() }
    });
}

function clientQuestions(attempt) {
    return attempt.questions.map((q, i) => ({
        i, kind: q.kind, prompt: q.prompt,
        options: q.kind === 'mcq' ? q.options : undefined
    }));
}

router.post('/exam/start', requireLearner(async (req, res, who) => {
    const slug = String((req.body && req.body.slug) || '');
    const topicN = parseInt((req.body && req.body.topicN), 10);
    const mod = curriculum.getModule(slug);
    if (!mod || Number.isNaN(topicN) || topicN < 0 || topicN > mod.topics.length) {
        return res.status(400).json({ success: false, message: 'Unknown exam.' });
    }
    const isFinal = topicN === 0;

    const access = await courseAccessFor(who);
    if (!access.portals.course.granted) {
        return res.status(402).json({ success: false, payRequired: true, message: 'The course is not unlocked yet.' });
    }

    const progress = await progressFor(who, slug);

    // The gate for THIS exam.
    if (isFinal) {
        if (firstUnsettled(mod, progress) <= mod.topics.length) {
            return res.status(403).json({ success: false, message: 'The final opens when every topic is settled.' });
        }
        if (progress.finalExam.passedAt) return res.status(409).json({ success: false, message: 'Already passed.' });
        if (progress.finalExam.closedByHRAt) return res.status(403).json({ success: false, message: 'This exam was closed by HR.' });
    } else {
        const st = topicState(progress, topicN);
        if (!st || !st.videoDoneAt) {
            return res.status(403).json({ success: false, message: 'The exam opens after the video.' });
        }
        if (st.passedAt) return res.status(409).json({ success: false, message: 'Already passed.' });
        if (st.closedByHRAt) return res.status(403).json({ success: false, message: 'This topic\'s exam was closed by HR. Carry on to the next topic.' });
    }

    // A pending proctor incident locks every exam in the domain until HR decides.
    const ProctorIncident = require('../../models/ProctorIncident');
    const hold = await ProctorIncident.findOne({ userId: who.id, domainSlug: slug, status: 'pending' }).lean();
    if (hold) {
        return res.status(423).json({ success: false, proctorHold: true,
            message: 'Your exams are on hold while HR reviews the proctoring warnings.' });
    }

    // Resume the live attempt rather than burning a fresh paper on a reload.
    const existing = await liveAttempt(who, slug, topicN);
    if (existing) {
        return res.json({ success: true, attemptId: String(existing._id),
            deadlineAt: existing.deadlineAt, warningCount: existing.warningCount,
            questions: clientQuestions(existing), resumed: true });
    }

    if (!learnExam.ready()) {
        return res.status(503).json({ success: false,
            message: 'The examiner is offline just now. Try again in a few minutes.' });
    }

    let paper;
    try {
        paper = await learnExam.generatePaper(mod, topicN);
    } catch (err) {
        console.error('[learn] paper generation failed:', err.message);
        return res.status(503).json({ success: false, message: 'Could not set the paper. Try again in a few minutes.' });
    }

    const minutes = isFinal ? learnExam.FINAL_MINUTES : learnExam.TOPIC_MINUTES;
    const attempt = await Attempt().create({
        userId: who.id, domainSlug: slug, topicN,
        questions: paper,
        deadlineAt: new Date(Date.now() + minutes * 60 * 1000)
    });

    const bump = isFinal
        ? { $inc: { 'finalExam.attempts': 1 } }
        : { $inc: { 'topics.$[t].attempts': 1 } };
    await LearnProgress().updateOne({ _id: progress._id }, bump,
        isFinal ? {} : { arrayFilters: [{ 't.n': topicN }] });

    res.status(201).json({ success: true, attemptId: String(attempt._id),
        deadlineAt: attempt.deadlineAt, warningCount: 0,
        minutes, questions: clientQuestions(attempt) });
}));

/*
 * The proctor saw something — no face, a second face, the tab hidden. Three of
 * these void the attempt and put the learner's exams in this domain on hold
 * until an HR decision, with the notice going to HR the moment it happens.
 */
router.post('/exam/:id/warning', requireLearner(async (req, res, who) => {
    const attempt = await Attempt().findById(req.params.id);
    if (!attempt || String(attempt.userId) !== String(who.id)) {
        return res.status(404).json({ success: false });
    }
    if (attempt.submittedAt || attempt.voidedAt) return res.json({ success: true, over: true });

    const reason = String((req.body && req.body.reason) || 'proctor event').slice(0, 140);
    attempt.warningCount += 1;
    const crossed = attempt.warningCount >= WARN_LIMIT;
    if (crossed) attempt.voidedAt = new Date();
    await attempt.save();

    if (!crossed) {
        return res.json({ success: true, warningCount: attempt.warningCount,
            remaining: WARN_LIMIT - attempt.warningCount });
    }

    const ProctorIncident = require('../../models/ProctorIncident');
    const incident = await ProctorIncident.create({
        userId: who.id, learnerName: who.name, learnerEmail: who.email,
        domainSlug: attempt.domainSlug, topicN: attempt.topicN, attemptId: attempt._id,
        warnings: [{ at: new Date(), reason }]
    });

    // Tell HR, in the portal and by mail. Neither may sink the response.
    try {
        const HR = require('../../models/HR');
        const EcosystemNotification = require('../../models/EcosystemNotification');
        const hrUsers = await HR.find({}).select('_id').lean();
        if (hrUsers.length) {
            await EcosystemNotification.insertMany(hrUsers.map((h) => ({
                userId: h._id, type: 'system_announcement',
                title: 'Proctoring limit crossed — decision needed',
                message: `${who.name} (${who.email}) crossed ${WARN_LIMIT} camera warnings in the ${attempt.domainSlug} exam. Approve a retake or close the topic.`,
                link: '/hr-proctor.html', data: { incidentId: String(incident._id) }
            })));
        }
    } catch (err) { console.error('[learn] HR notify failed:', err.message); }
    try {
        const { createEmailTransporter, mailerReady, renderEmail, EMAIL_FROM, HR_NOTIFY_EMAIL, PORTAL_URL } = require('../../utils/mailer');
        if (mailerReady()) {
            await createEmailTransporter().sendMail({
                from: EMAIL_FROM, to: HR_NOTIFY_EMAIL,
                subject: `[TEN] Proctoring review needed — ${who.name}`,
                html: renderEmail({
                    heading: 'Proctoring review needed',
                    bodyHtml: `<p>${who.name} (${who.email}) crossed ${WARN_LIMIT} camera warnings during the <b>${attempt.domainSlug}</b> exam (topic ${attempt.topicN || 'final'}). Their exams are on hold until a decision.</p>`,
                    cta: { label: 'Open the review queue', url: PORTAL_URL + '/hr-proctor.html' },
                    footerWhy: 'You are receiving this because you are on the TEN HR notification list.'
                })
            });
        }
    } catch (err) { console.error('[learn] HR mail failed:', err.message); }

    res.json({ success: true, warningCount: attempt.warningCount, voided: true,
        message: 'Three warnings — this attempt is void and HR has been asked to review.' });
}));

router.post('/exam/:id/submit', requireLearner(async (req, res, who) => {
    const attempt = await Attempt().findById(req.params.id);
    if (!attempt || String(attempt.userId) !== String(who.id)) {
        return res.status(404).json({ success: false });
    }
    if (attempt.voidedAt) return res.status(423).json({ success: false, message: 'This attempt was voided by proctoring.' });
    if (attempt.submittedAt) return res.status(409).json({ success: false, message: 'Already submitted.' });
    // The server's clock decides, with one minute of grace for the wire.
    if (Date.now() > attempt.deadlineAt.getTime() + 60 * 1000) {
        return res.status(410).json({ success: false, message: 'Time was up before this arrived.' });
    }

    const answers = (req.body && req.body.answers) || {};
    const mod = curriculum.getModule(attempt.domainSlug);

    const writtenIdx = [], writtenPairs = [];
    attempt.questions.forEach((q, i) => {
        q.givenAnswer = answers[i] === undefined ? null : answers[i];
        if (q.kind === 'mcq') {
            q.correct = Number(q.givenAnswer) === q.answerIndex;
        } else {
            writtenIdx.push(i);
            writtenPairs.push({ prompt: q.prompt, answer: q.givenAnswer });
        }
    });

    let verdicts;
    try {
        verdicts = await learnExam.gradeWritten(mod, attempt.topicN, writtenPairs);
    } catch (err) {
        console.error('[learn] grading failed:', err.message);
        // The paper is kept, nothing is lost, and the learner is not failed by
        // an outage — they are told to submit again in a moment.
        return res.status(503).json({ success: false, retryable: true,
            message: 'The marker is busy — your answers are safe, submit again in a moment.' });
    }
    verdicts.forEach((v, k) => {
        const q = attempt.questions[writtenIdx[k]];
        q.correct = v.correct;
        q.feedback = v.feedback;
    });

    const written = attempt.questions.filter((q) => q.kind === 'written');
    const mcq = attempt.questions.filter((q) => q.kind === 'mcq');
    attempt.writtenScore = written.filter((q) => q.correct).length;
    attempt.mcqScore = mcq.filter((q) => q.correct).length;
    attempt.passed = attempt.writtenScore >= written.length * learnExam.PASS_WRITTEN
                  && attempt.mcqScore >= mcq.length * learnExam.PASS_MCQ;
    attempt.submittedAt = new Date();
    await attempt.save();

    if (attempt.passed) {
        const progress = await progressFor(who, attempt.domainSlug);
        if (attempt.topicN === 0) {
            await LearnProgress().updateOne({ _id: progress._id },
                { $set: { 'finalExam.passedAt': new Date() } });
        } else {
            await LearnProgress().updateOne({ _id: progress._id, 'topics.n': attempt.topicN },
                { $set: { 'topics.$.passedAt': new Date() } });
        }
    }

    res.json({
        success: true, passed: attempt.passed,
        writtenScore: attempt.writtenScore, writtenTotal: written.length,
        mcqScore: attempt.mcqScore, mcqTotal: mcq.length,
        // Their paper back, marked — feedback per written answer, right answers NOT
        // revealed for MCQs, because the retake draws from the same well.
        review: attempt.questions.map((q) => ({
            kind: q.kind, prompt: q.prompt, given: q.givenAnswer,
            correct: q.correct, feedback: q.feedback || undefined
        }))
    });
}));

// ── the HR review queue ─────────────────────────────────────────────────────

router.get('/hr/incidents', requireHR(async (req, res) => {
    const ProctorIncident = require('../../models/ProctorIncident');
    const incidents = await ProctorIncident.find({}).sort({ status: 1, createdAt: -1 }).limit(200).lean();
    res.json({ success: true, incidents });
}));

router.post('/hr/incidents/:id/decide', requireHR(async (req, res) => {
    const action = String((req.body && req.body.action) || '');
    const note = String((req.body && req.body.note) || '').slice(0, 2000);
    const mailStudent = !!(req.body && req.body.mailStudent);
    if (action !== 'approve' && action !== 'reject') {
        return res.status(400).json({ success: false, message: 'approve or reject.' });
    }

    const ProctorIncident = require('../../models/ProctorIncident');
    const incident = await ProctorIncident.findById(req.params.id);
    if (!incident) return res.status(404).json({ success: false });
    if (incident.status !== 'pending') {
        return res.status(409).json({ success: false, message: 'Already decided.' });
    }

    incident.status = action === 'approve' ? 'approved' : 'rejected';
    incident.hrNote = note;
    incident.decidedBy = (req.session.hr && (req.session.hr.name || req.session.hr.username))
        || (req.session.adminUser && req.session.adminUser.username) || 'HR';
    incident.decidedAt = new Date();
    await incident.save();

    // Reject: that exam is closed for good, and the learner moves on — the
    // sequence gate treats a closed topic as settled.
    if (action === 'reject') {
        const progress = await LearnProgress().findOne({ userId: incident.userId, domainSlug: incident.domainSlug });
        if (progress) {
            if (incident.topicN === 0) {
                await LearnProgress().updateOne({ _id: progress._id },
                    { $set: { 'finalExam.closedByHRAt': new Date() } });
            } else {
                await LearnProgress().updateOne({ _id: progress._id, 'topics.n': incident.topicN },
                    { $set: { 'topics.$.closedByHRAt': new Date() } });
            }
        }
    }

    if (mailStudent && incident.learnerEmail) {
        try {
            const { createEmailTransporter, mailerReady, renderEmail, EMAIL_FROM, PORTAL_URL } = require('../../utils/mailer');
            if (mailerReady()) {
                await createEmailTransporter().sendMail({
                    from: EMAIL_FROM, to: incident.learnerEmail,
                    subject: action === 'approve'
                        ? 'Your TEN exam is unlocked again'
                        : 'About your TEN exam proctoring review',
                    html: renderEmail({
                        heading: action === 'approve' ? 'You can sit the exam again' : 'Proctoring review decision',
                        name: incident.learnerName,
                        bodyHtml: `<p>${action === 'approve'
                            ? 'HR reviewed the camera warnings from your exam and has unlocked a retake. Set up in a quiet spot, keep your face in frame, and take it again when ready.'
                            : 'HR reviewed the camera warnings from your exam and has closed that topic\'s exam. Your course continues from the next topic.'}</p>`
                            + (note ? `<p style="margin-top:10px;"><b>From HR:</b> ${note.replace(/</g, '&lt;')}</p>` : ''),
                        cta: { label: 'Back to my course', url: PORTAL_URL + '/learn' },
                        footerWhy: 'You are receiving this about your TEN LLM portal exam.'
                    })
                });
            }
        } catch (err) { console.error('[learn] decision mail failed:', err.message); }
    }

    res.json({ success: true, status: incident.status });
}));

// ── the project and the certificate ─────────────────────────────────────────

router.post('/module/:slug/project', requireLearner(async (req, res, who) => {
    const url = String((req.body && req.body.url) || '').trim();
    const note = String((req.body && req.body.note) || '').slice(0, 2000);
    const skip = !!(req.body && req.body.skip);
    if (!skip && !/^https?:\/\/.+\..+/.test(url)) {
        return res.status(400).json({ success: false, message: 'Give a link to the project, or choose to skip it.' });
    }
    const progress = await progressFor(who, req.params.slug);
    await LearnProgress().updateOne({ _id: progress._id }, {
        $set: skip ? { 'project.skippedAt': new Date() }
                   : { 'project.url': url, 'project.note': note, 'project.doneAt': new Date(), 'project.skippedAt': null }
    });
    res.json({ success: true, skipped: skip });
}));

/**
 * The certificate. Earning it needs every topic settled, the final passed and
 * the project done or skipped. RELEASING it additionally needs the fee to not
 * be outstanding: a pay-after-completion learner has reached exactly the
 * moment they promised to pay.
 */
router.get('/module/:slug/certificate', requireLearner(async (req, res, who) => {
    const mod = curriculum.getModule(req.params.slug);
    if (!mod) return res.status(404).json({ success: false });
    const progress = await progressFor(who, mod.slug);

    const allSettled = firstUnsettled(mod, progress) > mod.topics.length;
    const projectDone = !!(progress.project.doneAt || progress.project.skippedAt);
    if (!allSettled || !progress.finalExam.passedAt || !projectDone) {
        return res.status(403).json({ success: false,
            message: 'The certificate opens when every topic is settled, the final is passed and the project is done or skipped.' });
    }

    const access = await courseAccessFor(who);
    if (access.feeDue) {
        return res.status(402).json({ success: false, feeDue: access.feeDue,
            message: `You chose to pay after completion — this is completion. Settle ₹${access.feeDue.amount} and the certificate downloads immediately.` });
    }
    if (!access.portals.course.granted) {
        return res.status(402).json({ success: false, payRequired: true, message: 'The course fee is not settled.' });
    }

    if (!progress.certificateId) {
        progress.certificateId = 'TEN-LLM-' + mod.shortCode + '-' + String(progress._id).slice(-6).toUpperCase()
            + '-' + Date.now().toString(36).toUpperCase();
        progress.certIssuedAt = new Date();
        await progress.save();
    }

    // One page, one certificate — pdfkit straight to the response.
    const PDFDocument = require('pdfkit');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="TEN-${mod.shortCode}-certificate.pdf"`);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    doc.pipe(res);
    const W = doc.page.width, H = doc.page.height;
    doc.rect(0, 0, W, H).fill('#0c1220');
    doc.rect(18, 18, W - 36, H - 36).lineWidth(2).stroke('#f5c542');
    doc.fillColor('#f5c542').fontSize(13).font('Helvetica-Bold')
        .text('THE ENTREPRENEURSHIP NETWORK', 0, 70, { align: 'center', characterSpacing: 4 });
    doc.fillColor('#fff7d6').fontSize(30).text('Certificate of Completion', 0, 110, { align: 'center' });
    doc.fillColor('#9aa4b8').fontSize(13).font('Helvetica').text('This certifies that', 0, 175, { align: 'center' });
    doc.fillColor('#ffffff').fontSize(26).font('Helvetica-Bold').text(who.name, 0, 200, { align: 'center' });
    doc.fillColor('#9aa4b8').fontSize(13).font('Helvetica')
        .text('has completed every module, passed the proctored final examination, and finished the', 0, 245, { align: 'center' })
        .text(`course of study in`, 0, 262, { align: 'center' });
    doc.fillColor('#f5c542').fontSize(20).font('Helvetica-Bold').text(mod.name, 0, 285, { align: 'center' });
    doc.fillColor('#7d8698').fontSize(10).font('Helvetica')
        .text(`Certificate ID: ${progress.certificateId}`, 0, 340, { align: 'center' })
        .text(`Issued ${new Date(progress.certIssuedAt).toDateString()} · verify at ${(process.env.PORTAL_URL || 'https://virtualinternships.entrepreneurshipnetwork.net')}/api/v2/learn/verify/${progress.certificateId}`, 0, 356, { align: 'center' });
    doc.end();
}));

/** Public: anyone holding a certificate id can check it is real. */
router.get('/verify/:certId', async (req, res) => {
    try {
        const progress = await LearnProgress().findOne({ certificateId: req.params.certId })
            .populate('userId', 'fullName email').lean();
        if (!progress) return res.status(404).json({ success: false, valid: false });
        const mod = curriculum.getModule(progress.domainSlug);
        res.json({ success: true, valid: true,
            name: progress.userId && progress.userId.fullName,
            course: mod ? mod.name : progress.domainSlug,
            issuedAt: progress.certIssuedAt });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;
