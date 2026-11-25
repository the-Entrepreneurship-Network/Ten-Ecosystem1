'use strict';

/**
 * The complaints@ help desk, end to end against a fake Gmail.
 *
 * What must hold: a reply lands in the student's thread; drafts wait in draft
 * mode and replies go out in send mode; account details only reach a sender
 * Gmail verified; robots, the team's own conversations and touchy topics are
 * left to people; one email is never answered twice; and a conversation the
 * team labels "Help desk/Teach" becomes a new answer.
 */

const STARTERS = [{
    key: 'employee-id',
    question: 'How do I get my Employee ID?',
    examples: ['what is my employee id', 'emp id not received'],
    answer: 'You get your Employee ID when you register: {{registerUrl}}',
    personal: 'Your Employee ID is {{employeeId}}.'
}];

const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
/** The raw reply as a person would read it: base64url off, quoted-printable undone. */
function unb64(s) {
    const qp = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1').replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < qp.length; i++) {
        if (qp[i] === '=' && /^[0-9A-F]{2}$/.test(qp.substr(i + 1, 2))) { bytes.push(parseInt(qp.substr(i + 1, 2), 16)); i += 2; }
        else bytes.push(qp.charCodeAt(i));
    }
    return Buffer.from(bytes).toString('utf8');
}

function mail({ id = 'm1', threadId = 't1', from = 'Asha Rao <asha@gmail.com>', subject = 'emp id',
    body = 'sir what is my employee id', headers = {}, labelIds = ['INBOX'], internalDate = '1000', verified = false } = {}) {
    const h = [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: `<${id}@mail.gmail.com>` }];
    if (verified) {
        h.push({ name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@gmail.com; spf=pass; dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=gmail.com' });
    }
    for (const [k, v] of Object.entries(headers)) h.push({ name: k, value: v });
    return { id, threadId, labelIds, internalDate, payload: { mimeType: 'text/plain', headers: h, body: { data: b64(body) } } };
}

function fakeGmail({ messages = [], threads = {}, teach = [] } = {}) {
    const g = {
        sent: [], drafts: [], labels: [],
        configured: () => true,
        profile: async () => ({ emailAddress: 'complaints@entrepreneurshipnetwork.net' }),
        listMessages: jest.fn(async () => messages.map((m) => ({ id: m.id }))),
        getMessage: jest.fn(async (id) => messages.find((m) => m.id === id)),
        getThread: jest.fn(async (id) => ({ messages: threads[id] || messages.filter((m) => m.threadId === id) })),
        threadsLabelled: jest.fn(async () => teach.map((id) => ({ id }))),
        labelId: async (name) => 'L:' + name,
        labelThread: jest.fn(async (threadId, add = [], remove = []) => { g.labels.push({ threadId, add, remove }); }),
        send: jest.fn(async (raw, threadId) => { g.sent.push({ raw: unb64(raw), threadId }); }),
        createDraft: jest.fn(async (raw, threadId) => { g.drafts.push({ raw: unb64(raw), threadId }); })
    };
    return g;
}

function stores() {
    const tickets = [];
    const answers = [];
    const matches = (row, q) => Object.entries(q).every(([k, v]) => {
        if (v && v.$in) return v.$in.includes(row[k]);
        if (v && v.$gte) return row[k] >= v.$gte;
        return row[k] === v;
    });
    const SupportTicket = {
        rows: tickets,
        create: jest.fn(async (doc) => {
            if (tickets.some((t) => t.gmailId === doc.gmailId)) { const e = new Error('duplicate'); e.code = 11000; throw e; }
            const row = Object.assign({ _id: 't' + tickets.length, createdAt: new Date(), action: 'working' }, doc);
            tickets.push(row);
            return row;
        }),
        findOne: jest.fn(async (q) => tickets.find((t) => matches(t, q)) || null),
        updateOne: jest.fn(async ({ _id }, { $set }) => { Object.assign(tickets.find((t) => t._id === _id), $set); }),
        countDocuments: jest.fn(async (q) => tickets.filter((t) => matches(t, q)).length),
        find: jest.fn(async (q) => tickets.filter((t) => matches(t, q)))
    };
    const SupportAnswer = {
        rows: answers,
        find: jest.fn(async (q) => answers.filter((a) => q.active === undefined || a.active === q.active)),
        findOne: jest.fn(async (q) => answers.find((a) => a.starterKey === q.starterKey) || null),
        create: jest.fn(async (doc) => {
            const row = Object.assign({ _id: 'a' + answers.length, active: true, uses: 0, edited: false }, doc);
            answers.push(row);
            return row;
        }),
        updateOne: jest.fn(async ({ _id }, u) => {
            const row = answers.find((a) => a._id === _id);
            if (u.$set) Object.assign(row, u.$set);
            if (u.$inc) row.uses += u.$inc.uses;
        })
    };
    let desk = null;
    const SupportDeskState = {
        doc: () => desk,
        set: (d) => { desk = Object.assign({ _id: 'bug-agent' }, d); },
        findById: jest.fn(() => ({ lean: async () => (desk ? Object.assign({}, desk) : null) })),
        findByIdAndUpdate: jest.fn((id, { $set }) => ({
            lean: async () => { desk = Object.assign({ _id: id, engine: 'claude' }, desk || {}, $set); return Object.assign({}, desk); }
        }))
    };
    return { SupportTicket, SupportAnswer, SupportDeskState };
}

function load(mode) {
    jest.resetModules();
    process.env.SUPPORT_AGENT_MODE = mode;
    const s = stores();
    jest.doMock('../../models/SupportTicket', () => s.SupportTicket);
    jest.doMock('../../models/SupportAnswer', () => s.SupportAnswer);
    jest.doMock('../../models/SupportDeskState', () => s.SupportDeskState);
    const gem = {
        ready: jest.fn(() => true),
        ask: jest.fn(async () => ({ kind: 'vague', reply: 'Could you tell us what you clicked and what you saw?' })),
        Type: { OBJECT: 'OBJECT', STRING: 'STRING' }
    };
    jest.doMock('../../utils/gemini', () => gem);
    jest.doMock('../../services/supportDesk/starterAnswers', () => STARTERS);
    jest.doMock('../../services/supportDesk/facts', () => ({
        STATIC: { registerUrl: 'https://portal.test/register' },
        PLACEHOLDERS: [],
        findStudent: jest.fn(async (email) => (email === 'asha@gmail.com' ? { name: 'Asha Rao', employeeId: 'TEN/WEB/1001' } : null)),
        valuesFor: jest.fn(async (st) => ({ firstName: 'Asha', employeeId: st.employeeId }))
    }));
    return Object.assign({ agent: require('../../services/supportDesk/agent'), gem }, s);
}

afterAll(() => { delete process.env.SUPPORT_AGENT_MODE; });

describe('answering', () => {
    test('draft mode leaves a threaded reply as a draft and labels it', async () => {
        const { agent, SupportTicket } = load('draft');
        const gmail = fakeGmail({ messages: [mail()] });
        await agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(0);
        expect(gmail.drafts).toHaveLength(1);
        const { raw, threadId } = gmail.drafts[0];
        expect(threadId).toBe('t1');
        expect(raw).toMatch(/^In-Reply-To: <m1@mail\.gmail\.com>/m);
        expect(raw).toMatch(/^Subject: Re: emp id/m);
        expect(raw).toContain('https://portal.test/register');
        expect(raw).not.toMatch(/^Auto-Submitted:/m);
        expect(gmail.labels).toContainEqual({ threadId: 't1', add: ['Help desk/Draft ready'], remove: [] });
        expect(SupportTicket.rows[0]).toEqual(expect.objectContaining({ action: 'drafted', from: 'asha@gmail.com' }));
    });

    test('send mode sends it, marked as an automatic reply', async () => {
        const { agent, SupportAnswer } = load('send');
        const gmail = fakeGmail({ messages: [mail()] });
        await agent.runOnce({ gmail });
        expect(gmail.drafts).toHaveLength(0);
        expect(gmail.sent).toHaveLength(1);
        expect(gmail.sent[0].raw).toMatch(/^Auto-Submitted: auto-replied/m);
        expect(gmail.labels).toContainEqual({ threadId: 't1', add: ['Help desk/Answered'], remove: [] });
        expect(SupportAnswer.rows[0].uses).toBe(1);
    });

    test('account details go only to a sender Gmail verified', async () => {
        let ctx = load('send');
        let gmail = fakeGmail({ messages: [mail({ verified: true })] });
        await ctx.agent.runOnce({ gmail });
        expect(gmail.sent[0].raw).toContain('Your Employee ID is TEN/WEB/1001.');
        expect(gmail.sent[0].raw).toContain('Hi Asha,');

        ctx = load('send');
        gmail = fakeGmail({ messages: [mail({ verified: false })] });
        await ctx.agent.runOnce({ gmail });
        expect(gmail.sent[0].raw).not.toContain('TEN/WEB/1001');
        expect(gmail.sent[0].raw).toContain('https://portal.test/register');
    });

    test('an email is answered once, however many runs see it', async () => {
        const { agent } = load('send');
        const gmail = fakeGmail({ messages: [mail()] });
        await agent.runOnce({ gmail });
        await agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(1);
    });

    test('mode off reads nothing', async () => {
        const { agent } = load('off');
        const gmail = fakeGmail({ messages: [mail()] });
        await agent.runOnce({ gmail });
        expect(gmail.listMessages).not.toHaveBeenCalled();
    });
});

describe('leaving it to a person', () => {
    test('no matching answer: send mode says a person will reply; draft mode only labels', async () => {
        let ctx = load('send');
        let gmail = fakeGmail({ messages: [mail({ subject: 'hostel', body: 'my laptop broke during the hackathon' })] });
        await ctx.agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(1);
        expect(gmail.sent[0].raw).toContain('A member of our team will read your message');
        expect(gmail.labels).toContainEqual({ threadId: 't1', add: ['Help desk/Needs reply'], remove: [] });
        expect(ctx.SupportTicket.rows[0].action).toBe('held');

        ctx = load('draft');
        gmail = fakeGmail({ messages: [mail({ subject: 'hostel', body: 'my laptop broke during the hackathon' })] });
        await ctx.agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(0);
        expect(gmail.drafts).toHaveLength(0);
        expect(ctx.SupportTicket.rows[0].action).toBe('human');
    });

    test('money disputes and similar go to a person even when an answer matches', async () => {
        const { agent, SupportTicket } = load('send');
        const gmail = fakeGmail({ messages: [mail({ body: 'what is my employee id, and I want a refund' })] });
        await agent.runOnce({ gmail });
        expect(gmail.sent[0].raw).not.toContain('register');
        expect(SupportTicket.rows[0]).toEqual(expect.objectContaining({ action: 'held', reason: 'a topic a person should handle' }));
    });

    test('robots are never answered', async () => {
        const { agent, SupportTicket } = load('send');
        const gmail = fakeGmail({ messages: [
            mail({ id: 'a', threadId: 'ta', headers: { 'Auto-Submitted': 'auto-replied' } }),
            mail({ id: 'b', threadId: 'tb', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }),
            mail({ id: 'c', threadId: 'tc', headers: { 'List-Unsubscribe': '<mailto:x@y.z>' } })
        ] });
        await agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(0);
        expect(SupportTicket.rows.map((t) => t.action)).toEqual(['skipped', 'skipped', 'skipped']);
    });

    test('a conversation the team already answered, or is handling, is left alone', async () => {
        const { agent, SupportTicket } = load('send');
        const student = mail();
        const teamReply = mail({ id: 'r1', from: 'complaints@entrepreneurshipnetwork.net', labelIds: ['SENT'], internalDate: '2000' });
        const followUp = mail({ id: 'f2', threadId: 't2', internalDate: '3000' });
        const earlier = Object.assign(mail({ id: 'e2', threadId: 't2', internalDate: '500' }), { labelIds: ['INBOX', 'L:Help desk/Needs reply'] });
        const gmail = fakeGmail({ messages: [student, followUp], threads: { t1: [student, teamReply], t2: [earlier, followUp] } });
        await agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(0);
        expect(SupportTicket.rows.map((t) => t.reason)).toEqual(['the team already replied', 'the team is handling this conversation']);
    });

    test('after three automatic replies to one sender in a day, a person takes over', async () => {
        const { agent, SupportTicket } = load('send');
        for (let i = 0; i < 3; i++) {
            SupportTicket.rows.push({ _id: 'old' + i, gmailId: 'old' + i, from: 'asha@gmail.com', action: 'sent', createdAt: new Date() });
        }
        const gmail = fakeGmail({ messages: [mail()] });
        await agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(0);
        expect(SupportTicket.rows[3]).toEqual(expect.objectContaining({ action: 'human', reason: 'several emails from this sender today' }));
    });
});

describe('learning from the team', () => {
    test('a conversation labelled Teach becomes a new answer, without the greeting and sign-off', async () => {
        const { agent, SupportAnswer } = load('draft');
        const question = mail({ id: 'q', threadId: 'teach1', subject: 'Stipend', body: 'Is this internship paid? Do we get a stipend?' });
        const reply = mail({
            id: 'r', threadId: 'teach1', from: 'complaints@entrepreneurshipnetwork.net', labelIds: ['SENT'], internalDate: '2000',
            body: 'Hi Asha,\n\nThis is an unpaid virtual internship, so there is no stipend.\n\nRegards,\nTEN Support'
        });
        const gmail = fakeGmail({ threads: { teach1: [question, reply] }, teach: ['teach1'] });
        await agent.runOnce({ gmail });
        const learned = SupportAnswer.rows.find((a) => a.source === 'taught');
        expect(learned).toEqual(expect.objectContaining({
            question: 'Stipend',
            answer: 'This is an unpaid virtual internship, so there is no stipend.'
        }));
        expect(learned.examples[0]).toContain('Do we get a stipend?');
        expect(gmail.labels).toContainEqual({ threadId: 'teach1', add: ['Help desk/Learned'], remove: ['Help desk/Teach'] });
    });

    test('until the team has replied, the Teach label stays, nothing is learned and the rest of the mail is still answered', async () => {
        const { agent, SupportAnswer } = load('draft');
        const question = mail({ id: 'q', threadId: 'teach2', body: 'question only' });
        const gmail = fakeGmail({ messages: [mail({ id: 'n1', threadId: 'tn' })], threads: { teach2: [question] }, teach: ['teach2'] });
        await agent.runOnce({ gmail });
        expect(SupportAnswer.rows.filter((a) => a.source === 'taught')).toHaveLength(0);
        expect(gmail.labels.filter((l) => l.threadId === 'teach2')).toHaveLength(0);
        expect(agent.lastRun.error).toBe('');
        expect(gmail.drafts).toHaveLength(1);
    });
});

describe('reading mail', () => {
    const { _internal: t } = load('off').agent;

    test('keeps what the person wrote, not the quoted thread or signature', () => {
        const body = 'When will I get my offer letter?\nThanks\n\nOn Mon, 23 Nov 2026 at 13:54, TEN Support <\ncomplaints@entrepreneurshipnetwork.net> wrote:\n> Hi,\n> earlier reply';
        expect(t.cleanBody(body)).toBe('When will I get my offer letter?\nThanks');
        expect(t.cleanBody('Hello\n--\nAsha Rao\nB.Tech')).toBe('Hello');
        expect(t.cleanBody('Hi\nSent from my iPhone')).toBe('Hi');
    });

    test('reads HTML-only mail as text', () => {
        const payload = { mimeType: 'multipart/alternative', parts: [
            { mimeType: 'text/html', headers: [], body: { data: b64('<p>Emp&nbsp;id <b>please</b></p><style>p{}</style>') } }
        ] };
        expect(t.bodyText(payload).replace(/\s+/g, ' ').trim()).toBe('Emp id please');
    });

    test('a placeholder with no value leaves the whole answer unused', () => {
        expect(t.render('Your ID is {{employeeId}}.', {})).toBeNull();
        expect(t.render('Your ID is {{employeeId}}.', { employeeId: 'X1' })).toBe('Your ID is X1.');
    });

    test('a forged From is not verified', () => {
        const forged = mail({ headers: { 'Authentication-Results': 'evil.example; dmarc=pass header.from=gmail.com' } });
        expect(t.verifiedSender(forged, t.parseAddress('asha@gmail.com'))).toBe(false);
        expect(t.verifiedSender(mail({ verified: true }), t.parseAddress('asha@gmail.com'))).toBe(true);
        expect(t.verifiedSender(mail({ verified: true }), t.parseAddress('asha@other.in'))).toBe(false);
    });
});

describe('Send all', () => {
    // t1's draft is still waiting; t2's was already sent or deleted in Gmail by a person.
    function waitingDrafts() {
        const gmail = fakeGmail({ messages: [mail(), mail({ id: 'm2', threadId: 't2', from: 'Ravi <ravi@gmail.com>' })] });
        gmail.listDrafts = jest.fn(async () => [{ id: 'd1', message: { threadId: 't1' } }, { id: 'mine', message: { threadId: 'hr-own' } }]);
        gmail.sendDraft = jest.fn(async () => ({}));
        return gmail;
    }

    test('every waiting reply goes out as it stands in Gmail, once, and nothing else is sent', async () => {
        const { agent, SupportTicket } = load('draft');
        const gmail = waitingDrafts();
        await agent.runOnce({ gmail });
        expect(SupportTicket.rows.map((t) => t.action)).toEqual(['drafted', 'drafted']);

        expect(await agent.sendAllDrafts({ gmail })).toEqual({ sent: 1, handled: 1, failed: 0 });
        expect(gmail.sendDraft.mock.calls).toEqual([['d1']]);
        expect(gmail.labels).toContainEqual({ threadId: 't1', add: ['Help desk/Answered'], remove: ['Help desk/Draft ready'] });
        expect(SupportTicket.rows.map((t) => t.action)).toEqual(['sent', 'human']);

        expect(await agent.sendAllDrafts({ gmail })).toEqual({ sent: 0, handled: 0, failed: 0 });
        expect(gmail.sendDraft).toHaveBeenCalledTimes(1);
    });

    test('a reply Gmail refuses stays waiting for the next press', async () => {
        const { agent, SupportTicket } = load('draft');
        const gmail = waitingDrafts();
        gmail.sendDraft = jest.fn().mockRejectedValueOnce(new Error('Gmail 500')).mockResolvedValue({});
        await agent.runOnce({ gmail });
        const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(await agent.sendAllDrafts({ gmail })).toEqual({ sent: 0, handled: 1, failed: 1 });
        quiet.mockRestore();
        expect(SupportTicket.rows[0].action).toBe('drafted');
        expect(await agent.sendAllDrafts({ gmail })).toEqual({ sent: 1, handled: 0, failed: 0 });
        expect(SupportTicket.rows[0].action).toBe('sent');
    });
});

describe('Copy to the team inbox (SUPPORT_COPY_TO)', () => {
    afterEach(() => { delete process.env.SUPPORT_COPY_TO; });

    function withRaw(gmail) {
        gmail.getRaw = jest.fn(async () => b64('From: Asha Rao <asha@gmail.com>\r\nSubject: emp id\r\n\r\nsir what is my employee id'));
        return gmail;
    }

    test('each student email reaches it, the original attached and Reply-To the student', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent } = load('draft');
        const gmail = withRaw(fakeGmail({ messages: [mail()] }));
        await agent.runOnce({ gmail });
        expect(gmail.drafts).toHaveLength(1);
        expect(gmail.sent).toHaveLength(1);
        const { raw, threadId } = gmail.sent[0];
        expect(threadId).toBeUndefined();
        expect(raw).toMatch(/^To: growth@entrepreneurshipnetwork\.net/m);
        expect(raw).toMatch(/^Reply-To: asha@gmail\.com/m);
        expect(raw).toMatch(/^Subject: \[complaints@\] emp id/m);
        expect(raw).toContain('Help desk: drafted');
        expect(raw).toMatch(/Content-Type: message\/rfc822/);
    });

    test('robots are not copied, and nothing is copied while it is unset', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        let ctx = load('draft');
        let gmail = withRaw(fakeGmail({ messages: [mail({ headers: { 'Auto-Submitted': 'auto-replied' } })] }));
        await ctx.agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(0);

        delete process.env.SUPPORT_COPY_TO;
        ctx = load('draft');
        gmail = withRaw(fakeGmail({ messages: [mail()] }));
        await ctx.agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(0);
        expect(gmail.getRaw).not.toHaveBeenCalled();
    });

    test('an email too big to attach still arrives as words', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent } = load('draft');
        const gmail = withRaw(fakeGmail({ messages: [mail()] }));
        const record = gmail.send;
        gmail.send = jest.fn().mockRejectedValueOnce(new Error('Request payload size exceeds the limit')).mockImplementation(record);
        await agent.runOnce({ gmail });
        expect(gmail.sent).toHaveLength(1);
        expect(gmail.sent[0].raw).toContain('(Attachments: see complaints@.)');
        expect(gmail.sent[0].raw).not.toMatch(/message\/rfc822/);
    });
});

describe('Waking the bug agent (BUG_AGENT_FIRE_URL, BUG_AGENT_TOKEN)', () => {
    afterEach(() => {
        delete process.env.SUPPORT_COPY_TO;
        delete process.env.BUG_AGENT_FIRE_URL;
        delete process.env.BUG_AGENT_TOKEN;
    });

    test('copied emails that read like a website problem wake it, once per run', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent, gem } = load('draft');
        gem.ask.mockResolvedValue({ kind: 'bug', reply: 'Thanks, the team is looking into it.' });
        const gmail = fakeGmail({ messages: [
            mail({ subject: 'task journey', body: 'my task journey page is not working' }),
            mail({ id: 'm2', threadId: 't2', from: 'Ravi <ravi@gmail.com>', subject: 'site down', body: 'cant login to the portal, error 500' })
        ] });
        gmail.getRaw = jest.fn(async () => b64('Subject: x\r\n\r\nbody'));
        const wake = jest.fn(async () => true);
        await agent.runOnce({ gmail, wake });
        expect(wake).toHaveBeenCalledTimes(1);
    });

    test('a website problem a saved answer already covers is copied but does not wake it', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent } = load('draft');
        const gmail = fakeGmail({ messages: [mail({ body: "I can't find my employee id anywhere" })] });
        gmail.getRaw = jest.fn(async () => b64('x'));
        const wake = jest.fn(async () => true);
        await agent.runOnce({ gmail, wake });
        expect(gmail.sent).toHaveLength(1);
        expect(gmail.sent[0].raw).toContain('Help desk: drafted');
        expect(wake).not.toHaveBeenCalled();
    });

    test('ordinary questions, and emails that were not copied, do not wake it', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const wake = jest.fn(async () => true);
        let ctx = load('draft');
        let gmail = fakeGmail({ messages: [mail()] });
        gmail.getRaw = jest.fn(async () => b64('x'));
        await ctx.agent.runOnce({ gmail, wake });
        expect(wake).not.toHaveBeenCalled();

        delete process.env.SUPPORT_COPY_TO;
        ctx = load('draft');
        gmail = fakeGmail({ messages: [mail({ body: 'the upload button is not working' })] });
        await ctx.agent.runOnce({ gmail, wake });
        expect(wake).not.toHaveBeenCalled();
    });
});

describe('Claude, Gemini (free) or Off', () => {
    afterEach(() => { delete process.env.SUPPORT_COPY_TO; });
    const report = () => mail({ subject: 'task journey', body: 'my task journey page is not working' });
    const withRaw = (gmail) => { gmail.getRaw = jest.fn(async () => b64('x')); return gmail; };

    test('Claude\'s check-in is filed away, never answered, ticketed or copied', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent, SupportTicket, SupportDeskState } = load('send');
        const gmail = withRaw(fakeGmail({ messages: [mail({ id: 'hb', threadId: 'thb',
            from: 'Growth <growth@entrepreneurshipnetwork.net>', subject: '[bug-agent] checking in', body: '', internalDate: String(Date.now()) })] }));
        await agent.runOnce({ gmail, wake: jest.fn() });
        expect(gmail.sent).toHaveLength(0);
        expect(gmail.drafts).toHaveLength(0);
        expect(SupportTicket.rows).toHaveLength(0);
        expect(gmail.labels).toContainEqual({ threadId: 'thb', add: ['Help desk/Bug agent'], remove: ['INBOX'] });
        expect(SupportDeskState.doc().lastPassAt).toBeInstanceOf(Date);
    });

    test('Gemini writes the first reply to a report, and Claude is not woken', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent, SupportTicket, SupportDeskState, gem } = load('draft');
        SupportDeskState.set({ engine: 'gemini' });
        const gmail = withRaw(fakeGmail({ messages: [report()] }));
        const wake = jest.fn();
        await agent.runOnce({ gmail, wake });
        expect(gem.ask).toHaveBeenCalledTimes(1);
        expect(gem.ask.mock.calls[0][0]).toContain('my task journey page is not working');
        expect(gmail.drafts).toHaveLength(1);
        expect(gmail.drafts[0].raw).toContain('Could you tell us what you clicked and what you saw?');
        expect(gmail.labels).toContainEqual({ threadId: 't1', add: ['Help desk/Draft ready', 'Help desk/Needs reply'], remove: [] });
        expect(SupportTicket.rows[0]).toEqual(expect.objectContaining({ action: 'drafted', reason: 'Gemini: vague' }));
        expect(wake).not.toHaveBeenCalled();
        // The copy tells Claude that a first reply already went out.
        expect(gmail.sent.find((m) => /^To: growth@/m.test(m.raw)).raw).toContain('Help desk: drafted (Gemini: vague)');
    });

    test('with Claude on, Gemini answers first and Claude is woken only for a real bug', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        let ctx = load('draft');
        let gmail = withRaw(fakeGmail({ messages: [report()] }));
        let wake = jest.fn(async () => 'woken');
        await ctx.agent.runOnce({ gmail, wake });
        expect(ctx.SupportTicket.rows[0]).toEqual(expect.objectContaining({ action: 'drafted', reason: 'Gemini: vague' }));
        expect(gmail.labels).toContainEqual({ threadId: 't1', add: ['Help desk/Draft ready'], remove: [] });
        expect(wake).not.toHaveBeenCalled();

        ctx = load('draft');
        ctx.gem.ask.mockResolvedValue({ kind: 'bug', reply: 'Thanks, the team is looking into it.' });
        gmail = withRaw(fakeGmail({ messages: [report()] }));
        wake = jest.fn(async () => 'woken');
        await ctx.agent.runOnce({ gmail, wake });
        expect(gmail.drafts[0].raw).toContain('the team is looking into it');
        expect(wake).toHaveBeenCalledTimes(1);

        // No Gemini answer: Claude takes it, as before.
        ctx = load('draft');
        ctx.gem.ready.mockReturnValue(false);
        gmail = withRaw(fakeGmail({ messages: [report()] }));
        wake = jest.fn(async () => 'woken');
        await ctx.agent.runOnce({ gmail, wake });
        expect(ctx.SupportTicket.rows[0].action).toBe('human');
        expect(wake).toHaveBeenCalledTimes(1);
    });

    test('if Gemini has nothing usable, the report goes to the team as before', async () => {
        const { agent, SupportTicket, SupportDeskState, gem } = load('draft');
        SupportDeskState.set({ engine: 'gemini' });
        gem.ask.mockRejectedValueOnce(new Error('Gemini returned 429'));
        const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
        const gmail = fakeGmail({ messages: [report()] });
        await agent.runOnce({ gmail });
        quiet.mockRestore();
        expect(gmail.drafts).toHaveLength(0);
        expect(SupportTicket.rows[0].action).toBe('human');
    });

    test('ordinary questions and touchy topics never go to Gemini', async () => {
        const { agent, SupportDeskState, gem } = load('draft');
        SupportDeskState.set({ engine: 'gemini' });
        const gmail = fakeGmail({ messages: [
            mail({ body: 'what are the fees' }),
            mail({ id: 'm2', threadId: 't2', from: 'Ravi <ravi@gmail.com>', body: 'the payment page is not working, I want a refund' })
        ] });
        await agent.runOnce({ gmail });
        expect(gem.ask).not.toHaveBeenCalled();
    });

    test('Off: neither Claude nor Gemini', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent, SupportDeskState, gem } = load('draft');
        SupportDeskState.set({ engine: 'off' });
        const gmail = withRaw(fakeGmail({ messages: [report()] }));
        const wake = jest.fn();
        await agent.runOnce({ gmail, wake });
        expect(wake).not.toHaveBeenCalled();
        expect(gem.ask).not.toHaveBeenCalled();
    });

    test('the alert email goes to the team inbox', async () => {
        process.env.SUPPORT_COPY_TO = 'growth@entrepreneurshipnetwork.net';
        const { agent, gem } = load('draft');
        gem.ask.mockResolvedValue({ kind: 'bug', reply: 'Thanks, the team is looking into it.' });
        const gmail = withRaw(fakeGmail({ messages: [report()] }));
        const wake = (notify) => notify('The Claude bug agent is not responding', 'its API trigger answered HTTP 401').then(() => 'failed');
        await agent.runOnce({ gmail, wake });
        const alert = gmail.sent.find((m) => /not responding/.test(m.raw));
        expect(alert.raw).toMatch(/^To: growth@entrepreneurshipnetwork\.net/m);
        expect(alert.raw).toContain('HTTP 401');
    });
});

describe('The Help Desk page can show what was sent', () => {
    test('each email keeps the reply sent, the draft written, or the note that a person will reply', async () => {
        let ctx = load('draft');
        let gmail = fakeGmail({ messages: [mail()] });
        await ctx.agent.runOnce({ gmail });
        expect(ctx.SupportTicket.rows[0].action).toBe('drafted');
        expect(ctx.SupportTicket.rows[0].reply).toContain('https://portal.test/register');

        ctx = load('send');
        gmail = fakeGmail({ messages: [mail({ subject: 'stipend', body: 'is there any stipend for this' })] });
        await ctx.agent.runOnce({ gmail });
        expect(ctx.SupportTicket.rows[0].action).toBe('held');
        expect(ctx.SupportTicket.rows[0].reply).toMatch(/A member of our team will read your message and reply/);
    });
});
