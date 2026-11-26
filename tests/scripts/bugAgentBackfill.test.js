'use strict';

/**
 * scripts/bug-agent-backfill.js: which old complaints@ conversations go to the
 * bug agent: by default, website problems it has not seen; with --all, every
 * student still waiting. Always the whole conversation, a waiting draft marked.
 */
const { pick, topic, gently } = require('../../scripts/bug-agent-backfill');

let n = 0;
function msg(from, subject, text, { labelIds = [], headers = [] } = {}) {
    n += 1;
    return {
        id: 'm' + n,
        internalDate: String(Date.parse('2026-11-23T10:00:00Z') + n * 60000),
        labelIds,
        payload: {
            mimeType: 'text/plain',
            headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }].concat(headers),
            body: { data: Buffer.from(text).toString('base64url') }
        }
    };
}
const opts = (seen = []) => ({ me: 'complaints@ten.test', copyTo: 'growth@ten.test', seen: new Set(seen) });

test('an unseen website problem goes over with the whole conversation, a waiting draft marked as such', () => {
    const report = msg('Riya Arora <riya@mail.test>', 'Upload', 'The upload button is not working.');
    const thread = {
        messages: [
            report,
            msg('TEN Support <complaints@ten.test>', 'Re: Upload', 'Thanks, we got your message.', { headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] }),
            msg('complaints@ten.test', 'Re: Upload', 'half-written reply', { labelIds: ['DRAFT'] })
        ]
    };
    const [copy, ...rest] = pick([thread], opts());
    expect(rest).toEqual([]);
    expect(copy.msg).toBe(report);
    expect(copy.mail.from).toEqual({ email: 'riya@mail.test', name: 'Riya Arora' });
    expect(copy.outcome.action).toBe('backfill');
    expect(copy.mail.body).toMatch(/^--- Student, .+ ---\nThe upload button is not working\./);
    expect(copy.mail.body).toMatch(/--- complaints@ \(automatic reply\), .+ ---\nThanks, we got your message\./);
    expect(copy.mail.body).toMatch(/--- complaints@ \(draft, not sent yet\), .+ ---\nhalf-written reply/);
});

test('what the agent has seen, other questions, robots and its own check-ins stay out', () => {
    const threads = [
        { messages: [msg('riya@mail.test', 'Re: Upload', 'Still not working.')] },
        { messages: [msg('amit@mail.test', 'Certificate', 'When will I get my certificate?')] },
        { messages: [msg('noreply@jobs.test', 'Error report', 'Delivery error')] },
        { messages: [msg('growth@ten.test', '[bug-agent] checking in', '')] }
    ];
    expect(pick(threads, opts(['riya@mail.test|upload']))).toEqual([]);
    expect(topic('Re: Fwd: Upload ')).toBe('upload');
    expect(topic('')).toBe('(no subject)');
});

test('--all: every student still waiting, about anything, with any waiting draft shown', () => {
    const auto = { headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] };
    const drafted = { messages: [
        msg('Asha <asha@mail.test>', 'Employee ID', 'I did not get my employee id'),
        msg('TEN Support <complaints@ten.test>', 'Re: Employee ID', 'You get your Employee ID the moment you register.', { labelIds: ['DRAFT'] })
    ] };
    const unanswered = { messages: [
        msg('ravi@mail.test', 'Marksheet', 'Can I upload my 12th marksheet instead?'),
        msg('Complaints user <complaints@ten.test>', 'Re: Marksheet', 'This is an auto-generated reply.', auto)
    ] };
    const answered = { messages: [
        msg('meena@mail.test', 'Fees', 'what are the fees'),
        msg('HR <complaints@ten.test>', 'Re: Fees', 'The fee is on the plans page.')
    ] };
    const copiedBefore = { messages: [msg('old@mail.test', 'Login', 'cannot log in')] };
    const opts = { me: 'complaints@ten.test', copyTo: 'growth@ten.test', all: true,
        seen: new Set(['asha@mail.test|employee id']), backfilled: new Set(['old@mail.test|login']) };

    const out = pick([drafted, unanswered, answered, copiedBefore], opts);
    expect(out.map((c) => c.mail.from.email)).toEqual(['asha@mail.test', 'ravi@mail.test']);
    expect(out[0].mail.body).toMatch(/--- complaints@ \(draft, not sent yet\), .+ ---\nYou get your Employee ID the moment you register\./);
    expect(out[0].outcome.reason).toMatch(/a reply is waiting in Drafts, check it/);
    expect(out[1].outcome.reason).toMatch(/no reply yet/);
    expect(out[1].mail.body).toContain('complaints@ (automatic reply)');
});

test('a "slow down" from Gmail is waited out; any other refusal is not', async () => {
    const wait = jest.fn(async () => {});
    const quota = Object.assign(new Error("Gmail GET /threads/t: 403 Quota exceeded for quota metric 'Total Query Cost'"), { status: 403 });
    const call = jest.fn().mockRejectedValueOnce(quota).mockResolvedValueOnce('thread');
    expect(await gently(call, wait)).toBe('thread');
    expect(call).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(61000);

    const denied = Object.assign(new Error('Gmail GET /threads/t: 403 Insufficient Permission'), { status: 403 });
    const once = jest.fn().mockRejectedValue(denied);
    await expect(gently(once, wait)).rejects.toThrow(/Insufficient Permission/);
    expect(once).toHaveBeenCalledTimes(1);
});
