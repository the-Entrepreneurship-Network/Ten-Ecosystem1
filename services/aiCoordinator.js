'use strict';

/**
 * TEN AI Coordinator: answers a student's private messages at any hour.
 *
 * A student opens a conversation with it in Messages, from the coordinator
 * card on their dashboard or by picking it in "New message". Each question
 * gets, in this order:
 *   1. a hand-over to the human coordinator when it is about marks, a
 *      complaint, money or something personal: the AI does not try those;
 *   2. a saved help-desk answer, when one clearly fits (free, no AI);
 *   3. Gemini (free tier), given the student's own progress and TEN's saved
 *      answers, but never their email, phone or Employee ID;
 *   4. a hand-over, when Gemini cannot answer or is not available.
 *
 * It says it is an AI: in its name, in the "AI" tag the chat shows, and in its
 * first message of every conversation. In chat it never approves, marks or
 * changes anything; it only talks. Its reviews of clear submissions are in
 * services/aiCoordinatorJobs.js, labelled as its own.
 *
 * server.js calls attach() once with the function that saves and delivers a
 * chat message, and onMessage() after every message it delivers.
 */

const Message = require('../models/Message');
const Student = require('../models/Student');
const Coordinator = require('../models/Coordinator');
const Attendance = require('../models/Attendance');
const Notification = require('../models/Notification');
const SupportAnswer = require('../models/SupportAnswer');
const AiCoordinatorLog = require('../models/AiCoordinatorLog');
const StudentTaskProgress = require('../models/new/StudentTaskProgress');
const DomainTask = require('../models/new/DomainTask');
const gemini = require('../utils/gemini');
const { COMPLAINTS_EMAIL } = require('../utils/mailer');
const { istDateKey, istDayStart } = require('../utils/dateKey');
const { getAttendanceSummary } = require('../utils/attendanceUtils');
const { filterByDomain } = require('../utils/attendanceDomain');
const chatIdentity = require('./chatIdentity');
const { match } = require('./supportDesk/matcher');
const facts = require('./supportDesk/facts');
const helpDesk = require('./supportDesk/agent');

const ID = 'ten-ai';
const NAME = 'TEN AI Coordinator';
/** A saved answer scoring this high is sent as it is, without asking Gemini. */
const DIRECT_SCORE = 0.6;
/** Gemini replies per student per day; saved answers do not count. */
const AI_PER_DAY = 20;
/** People send "hi", "sir", "my task?" as three messages: answer them as one. */
const WAIT_MS = 2500;

const INTRO = "Hi! I'm TEN's AI Coordinator: an AI assistant, not a person. I can help with your tasks, " +
    'attendance, documents and the portal, at any hour. Anything about marks, complaints, payments or ' +
    'personal matters goes to your coordinator.';

const enabled = () => !/^(off|false|0|no)$/i.test(String(process.env.AI_COORDINATOR || 'on').trim());
const isAssistantId = (id) => String(id || '').trim().toLowerCase() === ID;
const identityFor = (domain) => ({ role: 'assistant', id: ID, aliases: [ID], name: NAME, domain: domain || '' });

let hooks = { deliver: null, io: null, roster: () => [] };
/** @param {{deliver: Function, io?: object, roster?: Function}} opts */
function attach(opts = {}) { hooks = Object.assign({}, hooks, opts); }

// ── Hand-overs ───────────────────────────────────────────────────────────

/*
 * What the AI leaves to a person, checked before anything else. Narrow on
 * purpose: "how do I pay the fee?" is a question the saved answers cover;
 * "I paid but it is not showing" is a money problem for a person.
 */
const HANDOVER = [
    ['safety', /\b(suicid\w*|kill my ?self|end my life|self[- ]?harm|hurt(ing)? my ?self|don'?t want to live)\b/i],
    ['personal', /\b(depress\w*|anxiety|panic attack|mental(ly)? (health|ill|stress\w*)|harass\w*|abus\w*|bully\w*|personal (problem|issue|matter|reason|emergency)|family (problem|issue|emergency|matter)|(i am|i'm|im) (sick|ill|unwell|in hospital)|medical (issue|emergency|problem)|hospital\w*|accident|passed away|death in (my|the) family|funeral|pregnan\w*)\b/i],
    ['money', /\b(refund\w*|money back|return (my|the) money|(amount|money|payment) (got |was |is |has been )?(deducted|debited|cut)|charged (twice|two times|double)|double (payment|charge)|paid\b.{0,40}\bbut|payment (is |was |has |has been )?(failed|issue|problem|stuck|not (showing|reflect\w*|updated|received|verified|approved|confirmed))|stipend|salary|scam|fraud|cheat\w*)\b/i],
    ['marks', /\b(unfair\w*|not fair|wrong(ly)? (reject\w*|marks?|grade|score|review\w*)|re-?evaluat\w*|re-?check\w*|re-?review|appeal|dispute|(less|low|wrong) (marks?|score|grade))\b/i],
    ['complaint', /\b(complain\w*|not (happy|satisfied)|dissatisfied|worst|pathetic|unprofessional|rude|report (the |my |a )?coordinator|consumer (court|forum)|legal (action|notice)|police|lawyer)\b/i]
];

function handoverReason(text) {
    const s = String(text || '');
    for (const [reason, rx] of HANDOVER) if (rx.test(s)) return reason;
    return null;
}

const OPENERS = {
    safety: "I'm really sorry you're going through this. Please talk to someone right now: call Tele-MANAS on " +
        '14416 (free, at any hour) or 112 in an emergency.',
    personal: "I'm sorry to hear that. This needs a person, not an AI.",
    money: 'Payments need a person to check.',
    marks: 'Reviews are decided by your coordinator, not by me.',
    complaint: `I'm sorry about this. You can also write to ${COMPLAINTS_EMAIL}.`,
    sensitive: 'This one needs a person.',
    ai: 'This one needs a person.',
    unanswered: "I'm not sure about this one."
};

/** What the student is told when their message goes to a person. */
function handoverReply(reason, coordinator) {
    const name = coordinator && coordinator.name;
    const who = name && !/coordinator$/i.test(name) ? `your coordinator, ${name}` : 'your coordinator';
    return `${OPENERS[reason] || OPENERS.sensitive} I've passed your message to ${who}. ` +
        "They'll message you here in Messages as soon as they can.";
}

// ── The student's own record ─────────────────────────────────────────────

/** Never sent to Gemini: addresses, UPI IDs and phone numbers typed into a question. */
const scrub = (s) => String(s || '')
    .replace(/[\w.+-]+@[\w.-]+/g, '[address]')
    .replace(/(\+?91[\s-]?)?\b[6-9]\d{9}\b/g, '[phone]')
    .replace(/\b\d{11,}\b/g, '[number]');

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

async function attendanceOf(student, domain) {
    const records = await Attendance.find({ employeeId: student.employeeId })
        .select('dateKey status domain markedBy').lean();
    return getAttendanceSummary(filterByDomain(records, domain || student.domain, student), student);
}

const STATUS_LABEL = {
    available: 'not started',
    in_progress: 'started',
    submitted: 'submitted, quiz not passed yet',
    rejected: 'sent back by the coordinator'
};

/**
 * Where the student is in the Task Journey, read-only.
 *
 * The current week is the lowest week with a task that is open but not
 * approved. A locked task belongs to a week that has not opened yet.
 */
async function progressOf(student) {
    const rows = await StudentTaskProgress.find({ studentId: student._id })
        .select('taskId status quiz_passed coordinatorFeedback approvedAt').lean();
    if (!rows.length) return { total: 0, approved: 0, week: null, current: [], approvedAt: [] };
    const tasks = await DomainTask.find({ _id: { $in: rows.map((r) => r.taskId) } })
        .select('taskTitle weekNumber').lean();
    const byId = new Map(tasks.map((t) => [String(t._id), t]));
    const list = rows.map((r) => Object.assign({}, r, { task: byId.get(String(r.taskId)) })).filter((r) => r.task);
    const open = list.filter((r) => r.status !== 'approved' && r.status !== 'locked');
    const week = open.length ? Math.min(...open.map((r) => r.task.weekNumber || 1)) : null;
    return {
        total: list.length,
        approved: list.filter((r) => r.status === 'approved').length,
        week,
        current: open.filter((r) => (r.task.weekNumber || 1) === week).map((r) => ({
            title: r.task.taskTitle, status: r.status, feedback: r.coordinatorFeedback || ''
        })),
        approvedAt: list.filter((r) => r.status === 'approved' && r.approvedAt).map((r) => new Date(r.approvedAt))
    };
}

/** The coordinators of a domain: database accounts and the roster's. */
async function coordinatorsFor(domain) {
    const wanted = String(domain || '').trim().toLowerCase();
    if (!wanted) return [];
    const rx = new RegExp('^' + wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
    let db = [];
    try {
        db = await Coordinator.find({ domain: rx, verificationStatus: 'approved', supersededAt: null })
            .select('name email username domain').lean();
    } catch (err) { console.error('[ai-coordinator] coordinators:', err.message); }
    const people = db.map((c) => ({
        id: c.email || c.username, name: c.name || c.username || c.email, email: c.email || '', domain: c.domain
    }));
    for (const r of (hooks.roster && hooks.roster()) || []) {
        if (r.role !== 'coordinator' || String(r.domain || '').trim().toLowerCase() !== wanted) continue;
        if (people.some((p) => p.id === r.id)) continue;
        people.push({ id: r.id, name: r.name, email: /@/.test(r.id) ? r.id : '', domain: r.domain });
    }
    return people.filter((p) => p.id);
}

/** Every domain that has at least one coordinator, as the coordinators spell it. */
async function domainsWithCoordinators() {
    const out = new Map();
    try {
        for (const d of await Coordinator.distinct('domain', { verificationStatus: 'approved', supersededAt: null })) {
            if (d) out.set(String(d).trim().toLowerCase(), String(d).trim());
        }
    } catch (err) { console.error('[ai-coordinator] domains:', err.message); }
    for (const r of (hooks.roster && hooks.roster()) || []) {
        if (r.role === 'coordinator' && r.domain) out.set(String(r.domain).trim().toLowerCase(), String(r.domain).trim());
    }
    return Array.from(out.values());
}

async function contextFor(student, domain, values) {
    const lines = [`Domain: ${domain || 'not chosen yet'}`];
    if (!student) {
        lines.push('This person has no internship record yet: they may not have finished registering.');
        return lines.join('\n');
    }
    if (values.plan) lines.push(`Plan: ${values.plan}`);

    const att = await attendanceOf(student, domain).catch(() => null);
    if (att && att.startDate) {
        lines.push(`Internship: started ${day(att.startDate)}, ends ${day(att.endDate)} (day ${att.dayNumber}, ` +
            `${att.daysRemaining} days left).`);
        lines.push(`Attendance: ${att.percentage}% so far (${att.daysPresent} of ${att.workingDaysElapsed} working days; ` +
            'Monday to Saturday count; 75% is needed for the Letter of Completion' +
            (att.isEligible ? '' : `; ${att.stillNeedsByEnd} more present days are needed by the end`) +
            (att.canStillQualify ? '' : '; 75% can no longer be reached by the end date') + ').');
    }

    const p = await progressOf(student).catch(() => null);
    if (p && p.total) {
        lines.push(`Task Journey: ${p.approved} of ${p.total} tasks approved.` +
            (p.week ? ` Current week: ${p.week}. Passing a task's quiz approves it; a week opens when the week before is all approved.` : ''));
        for (const t of p.current.slice(0, 8)) {
            lines.push(`- Week ${p.week} task "${t.title}": ${STATUS_LABEL[t.status] || t.status}` +
                (t.status === 'rejected' && t.feedback ? ` (feedback: "${t.feedback.slice(0, 200)}")` : ''));
        }
    }

    try {
        const subs = await require('mongoose').model('Submission').find({ employeeId: student.employeeId })
            .sort({ submittedAt: -1 }).limit(5).select('task status feedback reviewedOnce').lean();
        for (const s of subs) {
            lines.push(`Submitted work "${String(s.task || 'a task').slice(0, 120)}": ${s.status || 'Pending'}` +
                (s.reviewedOnce && s.feedback && s.feedback !== 'No Feedback Yet' ? ` (coordinator's feedback: "${String(s.feedback).slice(0, 200)}")` : ''));
        }
    } catch (_) { /* Submission is registered by server.js; a test or script may not have it */ }

    for (const k of ['feeStatus', 'documentsStatus', 'offerLetterStatus', 'completionStatus']) {
        if (values[k]) lines.push(values[k]);
    }
    const coordinator = (await coordinatorsFor(domain))[0];
    if (coordinator) lines.push(`Their coordinator: ${coordinator.name}.`);
    return lines.join('\n');
}

// ── Deciding the reply ───────────────────────────────────────────────────

const PORTAL_MAP = [
    '- Dashboard (after signing in): the Employee ID at the top, the "Mark Today\'s Attendance" button (once a day, Monday to Saturday), the coordinator card, tasks to submit, and the menu to every page.',
    '- Task Journey (/v2-tasks.html): the weekly tasks. Watch the video, submit, then pass the task quiz; passing approves the task. The next week opens when this week is all approved.',
    '- Coordinator tasks are submitted from the dashboard with a GitHub or Drive link and a screenshot; the coordinator reviews them.',
    '- Attendance at meetings: scan the meeting QR code, pick the domain and sign in. 75% of working days is needed for the Letter of Completion.',
    '- My Documents (/my-documents.html): the offer letter, the Letter of Completion and the LOR, once they are issued.',
    '- My Certificates (/my-certificates.html): the optional paid Expert, Nano Degree and Fellowship certificates and what each needs.',
    '- Refer & Earn (/refer): the student\'s own invite link.',
    '- Learn (/learn): the courses.',
    '- Messages (/messages): private conversations with the coordinator, HR or other interns in the same domain.',
    `- Complaints: ${COMPLAINTS_EMAIL}.`
];

const SCHEMA = {
    type: gemini.Type.OBJECT,
    properties: {
        reply: { type: gemini.Type.STRING },
        handover: { type: gemini.Type.BOOLEAN },
        reason: { type: gemini.Type.STRING }
    },
    required: ['reply', 'handover']
};

function buildPrompt({ text, context, saved, domain }) {
    return [
        `You are "${NAME}", an AI assistant for interns of The Entrepreneurship Network (TEN), a virtual internship ` +
        `programme in India. You answer an intern's private messages in the internship portal${domain ? `, in the ${domain} domain` : ''}.`,
        '',
        'Rules:',
        '- You are an AI. Never claim to be a person; if asked, say you are an AI assistant.',
        '- Use only the facts below and TEN\'s saved answers. Never invent dates, fees, rules, links or promises.',
        '- Set "handover" to true for a dispute about marks or a review, a complaint, a refund or any money problem, a personal or health problem, or anything the facts do not answer.',
        '- You cannot approve tasks, mark attendance, issue documents or change anything. Say how the intern does it in the portal.',
        '- Never ask for a password, OTP or payment details.',
        '- Reply in the language the intern used (English or Hinglish), in simple words, in at most 120 words, without markdown headings.',
        '',
        'Where things are in the portal:',
        ...PORTAL_MAP,
        '',
        "This intern's own record (only they see your reply):",
        context,
        '',
        saved.length
            ? "TEN's saved answers that may be relevant:\n" + saved.map((s, i) => `${i + 1}. Q: ${s.question}\n   A: ${s.answer}`).join('\n')
            : 'No saved answer matched this question.',
        '',
        'The intern wrote:',
        text,
        '',
        'Answer with JSON: "reply" is your message to the intern; "handover" is true when a person must take it; "reason" says why, in a few words.'
    ].join('\n');
}

/** Fill {{placeholders}} from the student's values; drop any that cannot be filled. */
function fill(text, values) {
    return helpDesk._internal.render(text, values) || String(text).replace(/\{\{\s*\w+\s*\}\}/g, '').trim();
}

async function aiRepliesToday(employeeId) {
    if (!employeeId) return 0;
    return AiCoordinatorLog.countDocuments({
        employeeId, kind: 'answer', source: 'ai', createdAt: { $gte: istDayStart(istDateKey()) }
    });
}

/**
 * The reply to one question: { reply, source, handover? }.
 * `source` says where it came from, and for a hand-over, why.
 */
async function decide({ text, student, domain, employeeId }) {
    const coordinator = async () => (await coordinatorsFor(domain))[0];
    const handover = async (reason) => ({ reply: handoverReply(reason, await coordinator()), source: reason, handover: true });

    const why = handoverReason(text);
    if (why) return handover(why);

    // The help desk fills these on its first run, and it may be switched off.
    await helpDesk.seedStarters().catch(() => {});
    const answers = await SupportAnswer.find({ active: true }).lean();
    const found = match(text, answers);
    if (found.sensitive) return handover('sensitive');

    const values = Object.assign({}, facts.STATIC, student ? await facts.valuesFor(student) : {});
    const saved = (rows) => rows
        .map(({ entry }) => (student && entry.personal && helpDesk._internal.render(entry.personal, values)) ||
            helpDesk._internal.render(entry.answer, values))
        .filter(Boolean).join('\n\n');

    const top = found.answers[0];
    if (top && top.score >= DIRECT_SCORE) {
        const reply = saved(found.answers);
        if (reply) return { reply, source: 'saved' };
    }

    const nearly = found.answers.length ? saved(found.answers) : '';
    if (!gemini.ready()) return nearly ? { reply: nearly, source: 'saved' } : handover('unanswered');
    if (await aiRepliesToday(employeeId) >= AI_PER_DAY) {
        return nearly ? { reply: nearly, source: 'saved' } : {
            reply: "I've answered a lot of questions for you today, so I'll pick up new ones tomorrow. " +
                "If it can't wait, message your coordinator in Messages.",
            source: 'limit'
        };
    }

    try {
        const loose = match(text, answers, { threshold: 0.2 }).answers
            .map(({ entry }) => ({ question: entry.question, answer: helpDesk._internal.render(entry.answer, facts.STATIC) || '' }))
            .filter((s) => s.answer);
        const context = await contextFor(student, domain, values);
        const out = await gemini.ask(buildPrompt({ text: scrub(text), context, saved: loose, domain }), SCHEMA);
        const said = String((out && out.reply) || '').trim();
        if ((out && out.handover) || !said) return Object.assign(await handover('ai'), { reason: String((out && out.reason) || '').slice(0, 200) });
        return { reply: fill(said, values).slice(0, 1500), source: 'ai' };
    } catch (err) {
        console.warn('[ai-coordinator] Gemini did not answer:', err.message);
        return nearly ? { reply: nearly, source: 'saved' } : handover('unanswered');
    }
}

// ── Chat plumbing ────────────────────────────────────────────────────────

function typing(employeeId, room, on) {
    try {
        if (hooks.io) hooks.io.to('user::' + employeeId).emit('typing', { room, fromId: ID, from: NAME, typing: !!on });
    } catch (_) { /* a missing "typing…" costs nothing */ }
}

const HANDOVER_LABEL = {
    safety: 'their safety', personal: 'a personal matter', money: 'money', marks: 'marks or a review',
    complaint: 'a complaint', sensitive: 'something only a person can decide', ai: 'something the AI could not answer',
    unanswered: 'something the AI could not answer'
};

/**
 * Tell the domain's coordinators: the dashboard bell, live, and their phones.
 *
 * Who and what about, never the message itself: a notice is the domain's
 * shared list, and "I'm depressed" does not belong in it. The words are in the
 * AI Assistant tab and the daily summary, which need a staff sign-in.
 */
async function notifyCoordinators({ student, employeeId, domain, reason }) {
    try {
        const who = (student && (student.name || [student.firstName, student.lastName].filter(Boolean).join(' '))) || employeeId;
        const about = HANDOVER_LABEL[reason] || 'something only a person can answer';
        const notif = await Notification.create({
            title: reason === 'safety' ? 'URGENT: a student may be unsafe' : 'A student needs you',
            message: `${who} (${employeeId}) asked the AI Coordinator about ${about}. Read their message in the ` +
                `AI Assistant tab, then reply in Messages (New message, search ${employeeId}).`,
            type: reason === 'safety' ? 'urgent' : 'warning',
            from: NAME,
            targetType: 'coordinator-domain',
            targetDomain: domain
        });
        require('../utils/sseHub').broadcastNotification(domain, null, notif);
        const push = require('./pushService');
        for (const c of await coordinatorsFor(domain)) {
            push.sendToUser(c.id, {
                title: notif.title, body: `${who} asked about ${about}.`,
                url: '/coordinator-dashboard.html', tag: 'ai-handover-' + employeeId
            }).catch(() => {});
        }
    } catch (err) {
        console.error('[ai-coordinator] hand-over notice failed:', err.message);
    }
}

/** Answer everything the student wrote since the AI last spoke in this room. */
async function reply(identity, room) {
    const last = await Message.findOne({ chatRoom: room, senderId: ID }).sort({ timestamp: -1 }).select('timestamp').lean();
    const theirs = await Message.find({ chatRoom: room, senderRole: 'student', timestamp: { $gt: last ? last.timestamp : new Date(0) } })
        .sort({ timestamp: 1 }).limit(8).lean();
    if (!theirs.length) return null;
    const text = theirs.map((m) => m.message || '').filter(Boolean).join('\n').slice(0, 2000);
    const employeeId = identity.id;

    typing(employeeId, room, true);
    try {
        const student = await Student.findOne({ employeeId }).lean();
        const domain = identity.domain || (student && student.domain) || '';
        const outcome = text
            ? await decide({ text, student, domain, employeeId })
            : { reply: "I can't read photos yet. Please type your question and I'll answer it.", source: 'image' };

        const sent = await hooks.deliver(identityFor(domain), {
            room, text: ((last ? '' : INTRO + '\n\n') + outcome.reply).slice(0, 4000),
            replyTo: String(theirs[theirs.length - 1]._id)
        });
        if (!sent || !sent.success) console.error('[ai-coordinator] reply not delivered:', sent && sent.code);
        if (outcome.handover) await notifyCoordinators({ student, employeeId, domain, reason: outcome.source });

        await AiCoordinatorLog.create({
            kind: outcome.handover ? 'handover' : 'answer',
            employeeId, studentId: student ? student._id : null, domain,
            question: text.slice(0, 1000), reply: outcome.reply.slice(0, 2000),
            source: outcome.source, reason: outcome.reason || ''
        }).catch((err) => console.error('[ai-coordinator] log failed:', err.message));
        return outcome;
    } finally {
        typing(employeeId, room, false);
    }
}

const waiting = new Map();

/**
 * Called by server.js after every chat message it delivers. Never throws and
 * never delays the sender: the reply is worked out afterwards.
 */
function onMessage(identity, doc) {
    try {
        if (!enabled() || !hooks.deliver || !identity || identity.role !== 'student' || !doc) return;
        const room = doc.chatRoom;
        const pair = chatIdentity.dmParticipants(room);
        if (!pair || !pair.some(isAssistantId)) return;
        // ponytail: an in-process timer per conversation; pm2 runs one
        // instance. A restart drops a pending reply, and the student's next
        // message brings the unanswered ones back (reply() reads them all).
        clearTimeout(waiting.get(room));
        waiting.set(room, setTimeout(() => {
            waiting.delete(room);
            reply(identity, room).catch((err) => console.error('[ai-coordinator] reply failed:', err.message));
        }, WAIT_MS));
    } catch (err) {
        console.error('[ai-coordinator] onMessage:', err.message);
    }
}

// ── How the chat lists and shows it ──────────────────────────────────────

/** The row the Messages directory shows a student first. */
const directoryRow = (me) => ({ id: ID, name: NAME, role: 'assistant', domain: (me && me.domain) || '' });

/** What the profile panel beside the conversation shows. */
const profile = (me) => ({
    id: ID, name: NAME, role: 'assistant', online: enabled(), domain: (me && me.domain) || '',
    about: 'An AI assistant, not a person. It answers from TEN\'s saved answers and your own progress, at any hour, ' +
        'and passes marks, complaints, payments and personal matters to your coordinator.'
});

module.exports = {
    ID, NAME, enabled, isAssistantId, identityFor, attach, onMessage, directoryRow, profile,
    coordinatorsFor, domainsWithCoordinators, progressOf, attendanceOf, scrub, HANDOVER_LABEL,
    // for tests
    _internal: { handoverReason, handoverReply, scrub, buildPrompt, decide, reply, contextFor, STATUS_LABEL, AI_PER_DAY, INTRO }
};
