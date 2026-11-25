'use strict';

/**
 * One-time: show the bug agent the student emails it never saw.
 *
 * The help desk copies each new complaints@ email to SUPPORT_COPY_TO (growth@),
 * where the bug agent reads them, but only since that was set. This copies
 * every conversation since a date that reads like a website problem and has
 * no copy yet. Each copy holds the whole conversation, so the agent can tell
 * what was already answered (docs/bug-agent.md, "backfill").
 *
 *   node scripts/bug-agent-backfill.js 2026-11-22          lists them
 *   node scripts/bug-agent-backfill.js 2026-11-22 --send   copies them
 */
require('dotenv').config();
const gmail = require('../services/supportDesk/gmail');
const { _internal: desk } = require('../services/supportDesk/agent');

const fmt = (ms) => new Date(Number(ms)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
// ponytail: "already copied" means the same student and subject, so a second,
// separate conversation with the same subject counts as seen.
const topic = (subject) => String(subject || '').replace(/^\s*(?:(?:re|fwd?)\s*:\s*)+/i, '').trim().toLowerCase() || '(no subject)';

/** The conversations to copy, each with what the agent reads. */
function pick(threads, { me, copyTo, seen }) {
    const out = [];
    for (const thread of threads) {
        const msgs = (thread.messages || []).filter((m) => !(m.labelIds || []).includes('DRAFT'));
        const fromOf = (m) => desk.parseAddress(desk.header(m, 'from'));
        const text = (m) => desk.cleanBody(desk.bodyText(m.payload));
        const theirs = msgs.filter((m) => {
            const f = fromOf(m);
            return f.email !== me && f.email !== copyTo && !desk.automated(m, f);
        });
        const last = theirs[theirs.length - 1];
        if (!last) continue;
        const from = fromOf(last);
        const subject = desk.header(last, 'subject');
        if (seen.has(from.email + '|' + topic(subject))) continue;
        // ponytail: the same word list that wakes the agent for new mail.
        if (!theirs.some((m) => desk.LOOKS_LIKE_A_BUG.test(desk.header(m, 'subject') + '\n' + text(m)))) continue;
        const body = msgs.map((m) => {
            const f = fromOf(m);
            const who = f.email === from.email ? 'Student'
                : f.email === me ? 'complaints@' + (desk.automated(m, f) ? ' (automatic reply)' : '')
                : f.email;
            return `--- ${who}, ${fmt(m.internalDate)} ---\n${text(m)}`;
        }).join('\n\n');
        out.push({
            msg: last,
            mail: { from, subject, body },
            outcome: { action: 'backfill', reason: `arrived ${fmt(last.internalDate)}, before the bug agent was set up` }
        });
    }
    return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Gmail call, unhurried. Gmail allows a mailbox only so much work a
 * minute, and the live help desk shares it: a second between calls, and a
 * "slow down" (403 quota or rate limit, 429) is waited out, up to three times.
 */
async function gently(call, wait = sleep) {
    for (let tries = 0; ; tries += 1) {
        await wait(1000);
        try {
            return await call();
        } catch (err) {
            const slowDown = err && (err.status === 429 || (err.status === 403 && /quota|rate.?limit/i.test(err.message)));
            if (!slowDown || tries >= 3) throw err;
            console.log('Gmail asked for a pause. Waiting a minute...');
            await wait(61000);
        }
    }
}

async function main() {
    const [day, flag] = process.argv.slice(2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Usage: node scripts/bug-agent-backfill.js YYYY-MM-DD [--send]');
    const copyTo = String(process.env.SUPPORT_COPY_TO || '').trim().toLowerCase();
    if (!gmail.configured() || !copyTo) throw new Error('The help desk is not connected, or SUPPORT_COPY_TO is not set in .env.');
    const me = String((await gently(() => gmail.profile())).emailAddress || '').toLowerCase();

    const seen = new Set();
    for (const { id } of await gently(() => gmail.listMessages(`in:sent to:${copyTo} subject:"[complaints@]"`, 500))) {
        const copy = await gently(() => gmail.getMessage(id));
        seen.add(desk.parseAddress(desk.header(copy, 'reply-to')).email + '|' + topic(desk.header(copy, 'subject').replace(/^\[complaints@\]\s*/i, '')));
    }

    const since = Math.floor(Date.parse(day + 'T00:00:00+05:30') / 1000);
    const until = Math.floor(Date.now() / 1000) - 300; // anything newer, the help desk copies itself
    // ponytail: one page of 500 messages, about two weeks of complaints@.
    const found = await gently(() => gmail.listMessages(`after:${since} before:${until} -from:me -category:promotions -category:social -category:forums`, 500));
    const ids = [...new Set(found.map((m) => m.threadId))];
    console.log(`Reading ${ids.length} conversations, one a second (about ${Math.ceil(ids.length / 60)} min)...`);
    const threads = [];
    for (const threadId of ids) threads.push(await gently(() => gmail.getThread(threadId)));

    const todo = pick(threads, { me, copyTo, seen });
    let failed = 0;
    for (const c of todo) {
        console.log(`${fmt(c.msg.internalDate)}  ${c.mail.from.email}  ${c.mail.subject || '(no subject)'}`);
        if (flag === '--send' && !(await gently(() => desk.copyTo(gmail, me, c.msg, c.mail, c.outcome)))) {
            failed += 1;
            console.log('  could not copy this one');
        }
    }
    console.log(flag !== '--send' ? `${todo.length} to copy. Run it again with --send to copy them.`
        : `${todo.length - failed} copied to ${copyTo}. The bug agent handles them on its next run.` +
          (failed ? ` ${failed} failed: run it again later to copy just those.` : ''));
}

if (require.main === module) main().catch((err) => { console.error(err.message || err); process.exit(1); });

module.exports = { pick, topic, gently };
