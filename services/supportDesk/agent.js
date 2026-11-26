'use strict';

/**
 * The complaints@ help desk. Answers come from saved answers, not AI.
 *
 * Every two minutes (server.js) it reads new mail in the complaints@ inbox. For
 * each email from a person:
 *   1. it matches the email against the saved answers (./matcher.js);
 *   2. if one clearly fits, it writes the reply in the same thread, filled in
 *      from the student's own account when Gmail verified who sent it;
 *   3. otherwise it labels the conversation "Help desk/Needs reply" for the
 *      team and, in send mode, tells the student a person will answer.
 *
 * SUPPORT_AGENT_MODE: off (default) | draft (each reply waits in Gmail as a
 * draft for the team to check and send) | send (replies go out by themselves).
 *
 * It learns from the team: reply to a student yourself, add the label
 * "Help desk/Teach" to that conversation, and the next run saves the student's
 * question with your reply as a new answer.
 */
const MailComposer = require('nodemailer/lib/mail-composer');
const SupportAnswer = require('../../models/SupportAnswer');
const SupportTicket = require('../../models/SupportTicket');
const { escapeHtml, PORTAL_URL } = require('../../utils/mailer');
const { match } = require('./matcher');
const facts = require('./facts');
const starterAnswers = require('./starterAnswers');
const bugAgent = require('./bugAgent');

const LABEL = {
    answered: 'Help desk/Answered',
    draft: 'Help desk/Draft ready',
    human: 'Help desk/Needs reply',
    teach: 'Help desk/Teach',
    learned: 'Help desk/Learned',
    agent: 'Help desk/Bug agent'
};
// More than this many automatic replies a day to one sender is a conversation
// with another robot, or a person going round in circles. Either way, a human.
const PER_SENDER_PER_DAY = 3;
const NEW_MAIL = 'in:inbox newer_than:2d -from:me -category:promotions -category:social -category:forums';

function mode() {
    const m = String(process.env.SUPPORT_AGENT_MODE || 'off').trim().toLowerCase();
    return m === 'draft' || m === 'send' ? m : 'off';
}

// ── Reading a Gmail message ────────────────────────────────────────────────

const headersOf = (part) => (part && part.headers) || [];

function header(msg, name) {
    const h = headersOf(msg && msg.payload).find((x) => String(x.name).toLowerCase() === name);
    return h ? String(h.value || '') : '';
}

const fromB64url = (data) => Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const toB64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decode(part) {
    const buf = fromB64url(part.body && part.body.data);
    const type = (headersOf(part).find((h) => String(h.name).toLowerCase() === 'content-type') || {}).value || '';
    const charset = (/charset="?([\w-]+)/i.exec(type) || [])[1] || 'utf-8';
    try { return new TextDecoder(charset).decode(buf); } catch (_) { return buf.toString('utf8'); }
}

function bodyText(payload) {
    const parts = [];
    (function walk(p) {
        if (!p) return;
        if (p.parts) return p.parts.forEach(walk);
        if (!p.filename && p.body && p.body.data) parts.push(p);
    })(payload);
    const plain = parts.find((p) => p.mimeType === 'text/plain');
    if (plain) return decode(plain);
    const html = parts.find((p) => p.mimeType === 'text/html');
    if (!html) return '';
    return decode(html)
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/(?:p|div|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

/** What the person wrote this time: no quoted earlier mail, no signature. */
function cleanBody(text) {
    let t = String(text || '').replace(/\r/g, '');
    t = t.split(/\n[ \t]*On\b[^\n]{0,200}(?:\n[^\n]{0,200})?\bwrote:[ \t]*(?:\n|$)/i)[0];
    t = t.split(/\n[ \t]*-{2,}\s*Original Message\s*-{2,}/i)[0];
    t = t.split(/\n[ \t]*From:[^\n]*\n[ \t]*(?:Sent|Date):/i)[0];
    const out = [];
    for (const line of t.split('\n')) {
        const l = line.trim();
        if (l === '--') break;
        if (l.startsWith('>') || /^sent from my /i.test(l)) continue;
        out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
}

function parseAddress(value) {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value || '');
    return { email: (m ? m[2] : String(value || '')).trim().toLowerCase(), name: (m ? m[1] : '').trim() };
}

/** A first name from a display name, only when it looks like one. */
function nameFrom(display) {
    const first = String(display || '').trim().split(/\s+/)[0] || '';
    if (!/^[A-Za-z][A-Za-z'-]{1,19}$/.test(first)) return '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const autoSubmitted = (msg) => {
    const v = header(msg, 'auto-submitted').trim().toLowerCase();
    return !!v && v !== 'no';
};

/** Mail no person wrote. Answering it is how two robots end up mailing each other forever. */
function automated(msg, from) {
    const h = (name) => header(msg, name).trim().toLowerCase();
    if (autoSubmitted(msg)) return 'an automatic message';
    if (/^(?:bulk|junk|list|auto_reply)$/.test(h('precedence'))) return 'a bulk message';
    if (h('list-id') || h('list-unsubscribe')) return 'a mailing list';
    if (h('x-autoreply') || h('x-autorespond')) return 'an auto-reply';
    if (/multipart\/report/.test(h('content-type'))) return 'a delivery report';
    if (/^(?:mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)\b/.test(from.email)) return 'a no-reply sender';
    return '';
}

/**
 * Did Gmail confirm the sender really owns the From address?
 *
 * Anyone can type somebody else's address into From. Account details go out
 * only when Gmail's own check (DMARC) passed for that address's domain.
 */
function verifiedSender(msg, from) {
    const domain = from.email.split('@')[1] || '';
    const gmailCheck = headersOf(msg.payload)
        .filter((h) => String(h.name).toLowerCase() === 'authentication-results')
        .map((h) => String(h.value || '').toLowerCase())
        .find((v) => v.trim().startsWith('mx.google.com'));
    return !!(domain && gmailCheck && /\bdmarc=pass\b/.test(gmailCheck) && gmailCheck.includes('header.from=' + domain));
}

// ── Writing the reply ──────────────────────────────────────────────────────

const YES = PORTAL_URL + '/complaint-feedback?answer=yes';
const NO = PORTAL_URL + '/complaint-feedback?answer=no';

/** Fill {{placeholders}}; null when any is missing, so nothing half-filled is sent. */
function render(template, values) {
    let missing = false;
    const out = String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
        const v = values[key];
        if (v === undefined || v === null || v === '') { missing = true; return ''; }
        return String(v);
    });
    return missing ? null : out.trim();
}

function compose(firstName, blocks) {
    const body = blocks.length
        ? blocks.join('\n\n') +
          '\n\nDid this answer your question?\n\nYes, it is solved:\n' + YES +
          '\n\nNo, I still need help:\n' + NO
        : 'Thank you for writing to us. A member of our team will read your message and reply to you here soon.' +
          '\n\nIf you need help sooner, you can reach our team here:\n' + NO;
    return 'Hi ' + (firstName || 'there') + ',\n\n' + body + '\n\nTEN Support\nThe Entrepreneurship Network';
}

function toHtml(text) {
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">' +
        // A link at the end of a sentence must not swallow the full stop: "…/student-login." would 404.
        escapeHtml(text).replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)]/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>') +
        '</div>';
}

/** An email as Gmail's API wants it: raw RFC 822, base64url. */
const build = (fields) => new Promise((resolve, reject) => new MailComposer(fields).compile().build(
    (err, buf) => (err ? reject(err) : resolve(toB64url(buf)))));

/** The reply as Gmail wants it: raw, base64url, threaded under the student's message. */
function rawReply({ me, to, subject, text, msg, auto }) {
    const id = header(msg, 'message-id');
    const fields = {
        from: { name: process.env.SUPPORT_FROM_NAME || 'TEN Support', address: me },
        to,
        subject: /^re:/i.test(subject.trim()) ? subject.trim() : 'Re: ' + (subject.trim() || 'your message'),
        text,
        html: toHtml(text)
    };
    if (id) {
        fields.inReplyTo = id;
        fields.references = (header(msg, 'references').match(/<[^>]+>/g) || []).concat(id);
    }
    // RFC 3834: tells other auto-responders not to answer this one.
    if (auto) fields.headers = { 'Auto-Submitted': 'auto-replied' };
    return build(fields);
}

// ── One email ──────────────────────────────────────────────────────────────

/**
 * Is this conversation already a person's?
 *
 * 'replied': someone on the team answered after this message arrived.
 * 'handling': the conversation was handed to the team earlier, so a follow-up
 * in it stays with them rather than getting a robot reply mid-conversation.
 */
async function teamHas(gmail, msg) {
    if (!msg.threadId) return '';
    const others = ((await gmail.getThread(msg.threadId)).messages || []).filter((m) => m.id !== msg.id);
    const after = Number(msg.internalDate) || 0;
    if (others.some((m) => (m.labelIds || []).includes('SENT') && !autoSubmitted(m) && Number(m.internalDate) > after)) return 'replied';
    const human = await gmail.labelId(LABEL.human);
    return others.some((m) => (m.labelIds || []).includes(human)) ? 'handling' : '';
}

/** The ticket is written first: its unique gmailId is the lock against answering twice. */
async function claim(msg) {
    try {
        return await SupportTicket.create({ gmailId: msg.id, threadId: msg.threadId || '' });
    } catch (err) {
        if (err && err.code === 11000) return null;
        throw err;
    }
}

async function decide(gmail, me, msg, mail, answers) {
    const { from, subject, body } = mail;
    if (!from.email || from.email === me) return { action: 'skipped', reason: 'sent by the help desk itself' };
    if (from.email === copyAddress()) return { action: 'skipped', reason: 'from the team inbox' };
    const auto = automated(msg, from);
    if (auto) return { action: 'skipped', reason: auto };
    const team = await teamHas(gmail, msg);
    if (team === 'replied') return { action: 'skipped', reason: 'the team already replied' };
    if (team === 'handling') {
        await gmail.labelThread(msg.threadId, [LABEL.human]);
        return { action: 'human', reason: 'the team is handling this conversation' };
    }

    const recent = await SupportTicket.countDocuments({
        from: from.email,
        action: { $in: ['sent', 'drafted', 'held'] },
        createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) }
    });
    const verified = verifiedSender(msg, from);
    const student = verified ? await facts.findStudent(from.email) : null;
    const values = Object.assign({}, facts.STATIC, student ? await facts.valuesFor(student) : {});
    const firstName = values.firstName || nameFrom(from.name);
    const result = match(subject + '\n' + body, answers);

    const used = [];
    const blocks = [];
    for (const { entry, score } of result.answers) {
        const text = (student && entry.personal && render(entry.personal, values)) || render(entry.answer, values);
        if (!text) continue;
        blocks.push(text);
        used.push({ answerId: String(entry._id), question: entry.question, score: Math.round(score * 100) / 100 });
    }

    const base = { student: !!student, verified, answers: used };
    const desk = await bugAgent.state();
    const engine = desk.engine;
    const bugLike = LOOKS_LIKE_A_BUG.test(subject + '\n' + body);
    let why = recent >= PER_SENDER_PER_DAY ? 'several emails from this sender today'
        : result.sensitive ? 'a topic a person should handle'
        : !blocks.length ? `no saved answer fits (closest ${Math.round(result.best * 100)}%)`
        : '';
    // Before any saved answer goes out, Gemini (free) checks it answers this email and
    // not just its topic ("how to sign in" is no help when sign-in loops back to the
    // sign-in page). The word match alone sent such answers, and then Claude had to send
    // a second, right one. Gemini sees the general answer, never the student's own
    // details. No verdict from Gemini keeps the saved answer.
    if (!why && engine !== 'off') {
        const fits = await bugAgent.answerFits({
            subject, body, answer: result.answers.map(({ entry }) => render(entry.answer, facts.STATIC)).join('\n\n')
        }).catch((err) => { console.error('[help desk] Gemini check', String((err && err.message) || err).slice(0, 200)); return null; });
        if (fits === false) why = 'the saved answer does not answer this';
    }

    if (why) {
        // No saved answer settles it. Unless the switch on the Help Desk page says Off,
        // Gemini (free) reads a report of a website problem first. With Claude on and
        // answering, what neither settles goes to Claude, and only Claude replies: nothing
        // is sent from here, and handle() wakes it. Touchy topics and busy senders always
        // go to people.
        const free = !result.sensitive && recent < PER_SENDER_PER_DAY;
        const gem = free && bugLike && engine !== 'off'
            ? await bugAgent.geminiReply({
                subject, body, portalUrl: PORTAL_URL,
                known: answers.map((a) => a.question + ': ' + render(a.answer, facts.STATIC)).join('\n\n').slice(0, 8000)
            }).catch((err) => { console.error('[help desk] Gemini', String((err && err.message) || err).slice(0, 200)); return null; })
            : null;
        if (free && (!gem || gem.kind === 'bug') && engine === 'claude' && !desk.down && bugAgent.claudeReady()) {
            await gmail.labelThread(msg.threadId, [LABEL.agent]);
            return Object.assign(base, { action: 'agent', reason: gem ? 'Gemini found a website problem' : why, answers: [] });
        }
        if (gem) {
            const text = compose(firstName, [gem.reply]);
            // Claude is not taking it here, so the team follows up anything broken, and,
            // with Gemini on, anything Gemini could not settle.
            const labels = gem.kind === 'bug' || (engine === 'gemini' && gem.kind === 'vague') ? [LABEL.human] : [];
            if (mode() === 'send') {
                await gmail.send(await rawReply({ me, to: from.email, subject, text, msg, auto: true }), msg.threadId);
                await gmail.labelThread(msg.threadId, [LABEL.answered, ...labels]);
            } else {
                await gmail.createDraft(await rawReply({ me, to: from.email, subject, text, msg, auto: false }), msg.threadId);
                await gmail.labelThread(msg.threadId, [LABEL.draft, ...labels]);
            }
            return Object.assign(base, { action: mode() === 'send' ? 'sent' : 'drafted', reason: 'Gemini: ' + gem.kind, answers: [], reply: text.slice(0, 5000) });
        }
        // Say a person will answer, so nobody waits in silence; never into a loop.
        if (mode() === 'send' && recent < PER_SENDER_PER_DAY) {
            const text = compose(firstName, []);
            await gmail.send(await rawReply({ me, to: from.email, subject, text, msg, auto: true }), msg.threadId);
            await gmail.labelThread(msg.threadId, [LABEL.human]);
            return Object.assign(base, { action: 'held', reason: why, answers: [], reply: text.slice(0, 5000) });
        }
        await gmail.labelThread(msg.threadId, [LABEL.human]);
        return Object.assign(base, { action: 'human', reason: why, answers: [] });
    }

    const text = compose(firstName, blocks);
    if (mode() === 'send') {
        await gmail.send(await rawReply({ me, to: from.email, subject, text, msg, auto: true }), msg.threadId);
        await gmail.labelThread(msg.threadId, [LABEL.answered]);
    } else {
        await gmail.createDraft(await rawReply({ me, to: from.email, subject, text, msg, auto: false }), msg.threadId);
        await gmail.labelThread(msg.threadId, [LABEL.draft]);
    }
    for (const u of used) {
        await SupportAnswer.updateOne({ _id: u.answerId }, { $inc: { uses: 1 }, $set: { lastUsedAt: new Date() } });
    }
    return Object.assign(base, { action: mode() === 'send' ? 'sent' : 'drafted', reason: '', reply: text.slice(0, 5000) });
}

async function handle(gmail, me, msg, answers, stats) {
    const ticket = await claim(msg);
    if (!ticket) return;
    const mail = {
        from: parseAddress(header(msg, 'from')),
        subject: header(msg, 'subject'),
        body: cleanBody(bodyText(msg.payload))
    };
    let outcome;
    try {
        outcome = await decide(gmail, me, msg, mail, answers);
    } catch (err) {
        outcome = { action: 'failed', reason: String((err && err.message) || err).slice(0, 300) };
    }
    await SupportTicket.updateOne({ _id: ticket._id }, {
        $set: Object.assign({
            from: mail.from.email,
            fromName: mail.from.name.slice(0, 120),
            subject: mail.subject.slice(0, 300),
            excerpt: mail.body.slice(0, 600)
        }, outcome)
    });
    stats[outcome.action] = (stats[outcome.action] || 0) + 1;
    // Claude's emails are copied for it to read, and it is woken now. Without the copy it
    // cannot see the email, so a person takes it instead.
    const copied = await copyTo(gmail, me, msg, mail, outcome);
    if (outcome.action === 'agent' && !copied) {
        await gmail.labelThread(msg.threadId, [LABEL.human]).catch(() => {});
        await SupportTicket.updateOne({ _id: ticket._id }, { $set: { action: 'human', reason: 'could not copy it for Claude' } });
        return false;
    }
    return copied && outcome.action === 'agent';
}

/**
 * A copy of each student email for the mailbox in SUPPORT_COPY_TO (growth@),
 * where the bug agent reads them. complaints@ cannot forward by itself without
 * a two-step code only one person has, but the help desk can already send.
 * The original rides along as an attachment, screenshots included, and
 * Reply-To is the student. Robots and mail the team has answered stay out.
 */
async function copyTo(gmail, me, msg, mail, outcome) {
    const to = copyAddress();
    if (!to || outcome.action === 'skipped') return false;
    const fields = {
        from: { name: process.env.SUPPORT_FROM_NAME || 'TEN Support', address: me },
        to,
        replyTo: mail.from.email,
        subject: '[complaints@] ' + (mail.subject.trim() || '(no subject)'),
        text: `From: ${mail.from.name ? mail.from.name + ' ' : ''}<${mail.from.email}>\n` +
            `Help desk: ${outcome.action}${outcome.reason ? ' (' + outcome.reason + ')' : ''}\n\n${mail.body}` +
            // So the bug agent can check the reply really answered the student.
            (outcome.reply ? `\n\n--- Our reply ---\n${outcome.reply}` : '')
    };
    try {
        const raw = Buffer.from(await gmail.getRaw(msg.id), 'base64');
        await gmail.send(await build(Object.assign({}, fields, {
            attachments: [{ filename: 'original.eml', contentType: 'message/rfc822', content: raw }]
        })));
        return true;
    } catch (err) {
        // Too big to attach, most likely. The words still get through.
        return gmail.send(await build(Object.assign({}, fields, { text: fields.text + '\n\n(Attachments: see complaints@.)' })))
            .then(() => true, (e) => { console.error('[help desk] copy', String((e && e.message) || e).slice(0, 200)); return false; });
    }
}

// ponytail: a word list, so a report phrased some other way waits for the bug
// agent's next scheduled pass instead of waking it at once.
const LOOKS_LIKE_A_BUG = new RegExp('\\b(?:' + [
    'errors?|bugs?|crash(?:ed|es|ing)?|glitch|blank|stuck|freez(?:e|es|ing)|404|500',
    'not (?:working|opening|loading|showing|visible|submitting|uploading|updating|responding|accepting)',
    "(?:is|are|was|were)n'?t working|does(?:n'?t| not) work|won'?t (?:open|load|work)",
    "can(?:'|no)?t (?:open|log ?in|sign ?in|upload|submit|see|access|download|click|find)|unable to"
].join('|') + ')\\b', 'i');


/** SUPPORT_COPY_TO, the team inbox (growth@): copies go there, and so do the bug agent's alerts. */
const copyAddress = () => String(process.env.SUPPORT_COPY_TO || '').trim().toLowerCase();

/**
 * Claude's check-in: an email from the team inbox to complaints@ whose subject
 * starts "[bug-agent]" (docs/bug-agent.md). Noted, filed under
 * "Help desk/Bug agent" and out of the inbox, never answered or copied.
 */
async function checkIn(gmail, msg, notify) {
    const from = parseAddress(header(msg, 'from')).email;
    if (!copyAddress() || from !== copyAddress() || !/^\[bug-agent\]/i.test(header(msg, 'subject').trim())) return false;
    await bugAgent.heartbeat(new Date(Number(msg.internalDate) || Date.now()), notify);
    if (msg.threadId) await gmail.labelThread(msg.threadId, [LABEL.agent], ['INBOX']).catch(() => {});
    return true;
}

/** The bug agent's alerts, by email to the team inbox. Never throws. */
const notifier = (gmail) => async (subject, text) => {
    const to = copyAddress();
    if (!to) return;
    try {
        await gmail.send(await build({ from: { name: process.env.SUPPORT_FROM_NAME || 'TEN Support', address: me }, to, subject, text }));
    } catch (err) {
        console.error('[help desk] alert', String((err && err.message) || err).slice(0, 200));
    }
};

// ── Learning from the team ─────────────────────────────────────────────────

/** The team's reply without the "Hi Riya," and "Regards, …" around it. */
function tidyReply(text) {
    let lines = String(text || '').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && /^\s*(?:hi|hello|hey|dear)\b[^\n]{0,60}$/i.test(lines[0])) lines.shift();
    const end = lines.findIndex((l) => /^\s*(?:regards|best regards|warm regards|kind regards|thanks|thank you|thanks and regards|thanks & regards|sincerely|cheers)\b[ ,.!]*$/i.test(l));
    if (end > 0) lines = lines.slice(0, end);
    return lines.join('\n').trim().slice(0, 5000);
}

async function learn(gmail) {
    let learned = 0;
    const ours = (m) => (m.labelIds || []).includes('SENT') && !(m.labelIds || []).includes('DRAFT') && !autoSubmitted(m);
    for (const t of await gmail.threadsLabelled(LABEL.teach)) {
        const thread = await gmail.getThread(t.id);
        const msgs = thread.messages || [];
        const question = msgs.find((m) => !(m.labelIds || []).includes('SENT') && !(m.labelIds || []).includes('DRAFT'));
        const reply = msgs.slice().reverse().find(ours);
        if (!question || !reply) continue; // not answered yet: the label stays, next run tries again
        const subject = header(question, 'subject');
        const asked = cleanBody(bodyText(question.payload));
        const answer = tidyReply(cleanBody(bodyText(reply.payload)));
        if (answer && (subject || asked)) {
            await SupportAnswer.create({
                question: (subject || asked.split('\n')[0]).slice(0, 300),
                examples: [(subject + '\n' + asked).slice(0, 1500)],
                answer,
                source: 'taught'
            });
            learned++;
        }
        await gmail.labelThread(t.id, answer ? [LABEL.learned] : [], [LABEL.teach]);
    }
    return learned;
}

// ── The run ────────────────────────────────────────────────────────────────

let seeded = false;

/** Put the starter answers in the database; never overwrite one HR has edited. */
async function seedStarters() {
    if (seeded) return;
    for (const s of starterAnswers) {
        const fields = { question: s.question, examples: s.examples, answer: s.answer, personal: s.personal || '' };
        const existing = await SupportAnswer.findOne({ starterKey: s.key });
        if (!existing) await SupportAnswer.create(Object.assign({ starterKey: s.key, source: 'starter' }, fields));
        else if (!existing.edited) await SupportAnswer.updateOne({ _id: existing._id }, { $set: fields });
    }
    seeded = true;
}

const activeAnswers = async () =>
    (await SupportAnswer.find({ active: true })).map((a) => (a.toObject ? a.toObject() : a));

let running = false;
let me = '';
const lastRun = { at: null, error: '', stats: {} };

async function runOnce({ gmail = require('./gmail'), wake = bugAgent.wake } = {}) {
    // Under pm2 cluster mode only worker 0 runs jobs, as the idea agent does.
    const worker = process.env.NODE_APP_INSTANCE;
    if (!(worker === undefined || worker === '0')) return lastRun;
    if (mode() === 'off' || !gmail.configured() || running) return lastRun;
    running = true;
    const stats = {};
    try {
        await seedStarters();
        if (!me) me = String((await gmail.profile()).emailAddress || '').toLowerCase();
        stats.learned = await learn(gmail);
        const answers = await activeAnswers();
        // Labelled by the help desk already: answered by another server
        // connected to the same mailbox (staging, say), with its own database.
        const done = await Promise.all([LABEL.answered, LABEL.draft, LABEL.human].map((n) => gmail.labelId(n)));
        const notify = notifier(gmail);
        let bugReport = false;
        for (const { id } of await gmail.listMessages(NEW_MAIL, 25)) {
            if (await SupportTicket.findOne({ gmailId: id })) continue;
            const msg = await gmail.getMessage(id);
            if ((msg.labelIds || []).some((l) => done.includes(l))) continue;
            if (await checkIn(gmail, msg, notify)) { stats.checkIns = (stats.checkIns || 0) + 1; continue; }
            if (await handle(gmail, me, msg, answers, stats)) bugReport = true;
        }
        // Claude, when the switch says so. Once per run at most: the task takes 30
        // starts an hour, and runs are 2 minutes apart.
        if (bugReport && (await bugAgent.state()).engine === 'claude') stats.agentWoken = await wake(notify);
        await bugAgent.check(notify);
        Object.assign(lastRun, { at: new Date(), error: '', stats });
    } catch (err) {
        Object.assign(lastRun, { at: new Date(), error: String((err && err.message) || err).slice(0, 300), stats });
        console.error('[help desk]', lastRun.error);
    } finally {
        running = false;
    }
    return lastRun;
}

/**
 * HR's "Send all" button: every reply still waiting as a draft goes to its
 * student, as it stands in Gmail now, HR's edits included. A waiting
 * conversation with no draft left was sent or deleted in Gmail by a person.
 */
async function sendAllDrafts({ gmail = require('./gmail') } = {}) {
    const out = { sent: 0, handled: 0, failed: 0 };
    const waiting = (await SupportTicket.find({ action: 'drafted' })).filter((t) => t.threadId);
    if (!waiting.length) return out;
    const draftsIn = {};
    for (const d of await gmail.listDrafts()) {
        const threadId = d.message && d.message.threadId;
        if (threadId) (draftsIn[threadId] = draftsIn[threadId] || []).push(d.id);
    }
    for (const threadId of new Set(waiting.map((t) => t.threadId))) {
        const tickets = waiting.filter((t) => t.threadId === threadId);
        const mark = (action, reason) => Promise.all(tickets.map((t) =>
            SupportTicket.updateOne({ _id: t._id }, { $set: { action, reason } })));
        const drafts = draftsIn[threadId] || [];
        if (!drafts.length) {
            await mark('human', 'Sent or deleted in Gmail by a person');
            out.handled += tickets.length;
            continue;
        }
        try {
            for (const id of drafts) await gmail.sendDraft(id);
            await mark('sent', 'Sent from the Help Desk page');
            out.sent += drafts.length;
            await gmail.labelThread(threadId, [LABEL.answered], [LABEL.draft]).catch(() => {});
        } catch (err) {
            console.error('[help desk] send draft', String((err && err.message) || err).slice(0, 200));
            out.failed += 1;
        }
    }
    return out;
}

/** What HR's "Try a question" box shows: the reply a stranger would get. */
async function tryQuestion(text) {
    await seedStarters();
    const result = match(String(text || ''), await activeAnswers());
    const blocks = result.answers.map(({ entry }) => render(entry.answer, facts.STATIC)).filter(Boolean);
    return {
        answers: result.answers.map(({ entry, score }) => ({ id: String(entry._id), question: entry.question, score: Math.round(score * 100) / 100 })),
        sensitive: result.sensitive,
        reply: result.sensitive || !blocks.length ? null : compose('', blocks)
    };
}

module.exports = {
    runOnce, sendAllDrafts, tryQuestion, seedStarters, mode, lastRun, LABEL,
    // for tests, and for scripts/bug-agent-backfill.js
    _internal: { LOOKS_LIKE_A_BUG, cleanBody, bodyText, parseAddress, automated, verifiedSender, render, compose, toHtml, tidyReply, nameFrom, header, copyTo }
};
