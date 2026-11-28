#!/usr/bin/env node
'use strict';

/**
 * Which company job boards answer, and how many of their openings are in India.
 *
 * services/v2/atsBoards.js only lists boards that were checked, and the boards
 * are not reachable from every network, so this runs on the server:
 *
 *   node scripts/probe-ats-boards.js                  # the Indian candidates below
 *   node scripts/probe-ats-boards.js lever cred zeta  # one ATS, your own slugs
 *
 * A slug is the company's handle on that ATS, which is not always its brand
 * name. A board that answers with openings can be added to BOARDS.
 */

const { fromGreenhouse, fromLever, fromAshby } = require('../services/v2/atsBoards');

const FETCH = { greenhouse: fromGreenhouse, lever: fromLever, ashby: fromAshby };
const CANDIDATES = {
    greenhouse: ['postman', 'phonepe', 'browserstack', 'groww', 'druva', 'innovaccer', 'inmobi', 'mindtickle', 'chargebee', 'freshworks'],
    lever: ['cred', 'meesho', 'razorpay', 'zeta', 'hasura', 'dream11', 'sharechat', 'udaan', 'upgrad', 'slice', 'jupiter', 'zepto'],
    ashby: ['atlan', 'zepto', 'plum', 'smallcase'],
};
const INDIA = /\b(india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|noida|gurgaon|gurugram|chennai|kolkata|ahmedabad)\b/i;

async function main() {
    const [ats, ...slugs] = process.argv.slice(2);
    if (ats && !FETCH[ats]) {
        console.error(`Unknown ATS "${ats}". Use one of: ${Object.keys(FETCH).join(', ')}.`);
        process.exit(1);
    }
    const plan = ats ? { [ats]: slugs } : CANDIDATES;
    for (const [name, list] of Object.entries(plan)) {
        for (const slug of list) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const rows = await FETCH[name](slug, { timeoutMs: 8000 });
                const india = rows.filter((r) => INDIA.test(r.location || '')).length;
                console.log(`${rows.length ? 'ANSWERS' : 'EMPTY  '}  ${name.padEnd(10)} ${slug.padEnd(14)} ${rows.length} openings, ${india} in India`);
            } catch (err) {
                console.log(`NO       ${name.padEnd(10)} ${slug.padEnd(14)} ${err.message}`);
            }
        }
    }
}

main();
