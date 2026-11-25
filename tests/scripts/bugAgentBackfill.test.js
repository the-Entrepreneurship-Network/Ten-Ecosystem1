'use strict';

/**
 * scripts/bug-agent-backfill.js: which old complaints@ conversations go to the
 * bug agent. Only website problems it has not seen, from people, with the
 * whole conversation and never an unsent draft.
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

test('an unseen website problem goes over with the whole conversation, drafts left out', () => {
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
    expect(copy.mail.body).not.toMatch(/half-written/);
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
