'use strict';

/*
 * Writes services/v2/roleBriefs.js from the researched data.
 *
 *   node tools/buildRoleBriefs.js rolebriefs-raw.json
 *
 * Four named projects for each of the listed positions, stored in the same
 * did/subject/rest shape the shared briefs use, so an employer's substrate
 * splices into them the same way.
 */

const fs = require('fs');
const path = require('path');

const { POSITIONS } = require('../services/v2/careerData');

const raw = JSON.parse(fs.readFileSync(process.argv[2] || 'rolebriefs-raw.json', 'utf8'));
const stepsRaw = process.argv[3] && fs.existsSync(process.argv[3])
  ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  : { roles: [] };

const clean = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const byRole = new Map();
(raw.roles || []).forEach((r) => byRole.set(clean(r.role), (r.projects || []).map((p) => ({
  term: clean(p.term).toLowerCase(),
  artefact: clean(p.artefact),
  did: clean(p.did),
  rest: clean(p.rest),
  defend: clean(p.defend),
}))));

/*
 * The instructions, matched onto the project they belong to.
 *
 * Written in a second pass because a project has to exist before anybody can
 * say how to build it. Matched on the term, which is the only key both passes
 * were given, and a project with no steps keeps the shared recipe's — worse,
 * but never wrong.
 */
const stepsFor = new Map();
(stepsRaw.roles || []).forEach((r) => (r.projects || []).forEach((p) => {
  stepsFor.set(`${clean(r.role).toLowerCase()}::${clean(p.term).toLowerCase()}`, {
    hours: clean(p.hours),
    steps: (p.steps || []).map(clean).filter(Boolean),
  });
}));

const missing = POSITIONS.filter((p) => !byRole.has(p) || !byRole.get(p).length);
if (missing.length) {
  console.error(`no briefs for ${missing.length} positions: ${missing.join(', ')}`);
  process.exit(1);
}

/*
 * A project title must be unique across the whole file.
 *
 * The title is what dedupes entries on a page and what the picker shows, so
 * two positions landing on the same artefact means one of them silently loses
 * its project. Nothing is dropped here — the loser is qualified by its own
 * position, which is true and keeps it on the page.
 */
const seen = new Map();
let renamed = 0;
POSITIONS.forEach((role) => {
  byRole.get(role).forEach((p) => {
    const k = p.artefact.toLowerCase();
    if (!seen.has(k)) { seen.set(k, role); return; }
    p.artefact = `${p.artefact} for ${role.toLowerCase()}`;
    seen.set(p.artefact.toLowerCase(), role);
    renamed += 1;
  });
});
if (renamed) console.error(`${renamed} artefacts qualified to stay unique`);

/* A brief whose pieces do not read as one sentence is worse than none. */
const suspect = [];
POSITIONS.forEach((role) => byRole.get(role).forEach((p) => {
  if (!p.term || !p.artefact || !p.did || !p.rest) suspect.push(`${role}: empty field`);
  if (/^[A-Z]/.test(p.rest) && !p.rest.startsWith(',')) suspect.push(`${role} / ${p.term}: rest starts capitalised`);
  if (/\b\d+\s*(%|percent|x)\b/.test(p.rest)) suspect.push(`${role} / ${p.term}: rest asserts a figure`);
}));
if (suspect.length) console.error(`suspect: ${suspect.slice(0, 20).join(' | ')}`);

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

let withSteps = 0;
const lines = POSITIONS.map((role) => {
  const ps = byRole.get(role).map((p) => {
    const s = stepsFor.get(`${role.toLowerCase()}::${p.term}`);
    if (s && s.steps.length) withSteps += 1;
    const stepList = s && s.steps.length
      ? `[\n${s.steps.map((x) => `      ${q(x)},`).join('\n')}\n    ]`
      : '[]';
    return `    [${q(p.term)}, ${q(p.artefact)}, ${q(p.did)}, ${q(p.rest)}, ${q(p.defend)},\n`
      + `    ${q((s && s.hours) || '')}, ${stepList}],`;
  }).join('\n');
  return `  [${q(role)}, [\n${ps}\n  ]],`;
}).join('\n');
console.error(`${withSteps} projects carry their own instructions`);

const total = POSITIONS.reduce((n, r) => n + byRole.get(r).length, 0);

const out = `'use strict';

/**
 * Four named projects for every listed position.
 *
 * The shared briefs cover the engineering every backend job has in common —
 * sharding, tracing, idempotency — and about four fifths of what a position is
 * actually judged on had nothing written for it. Those terms fell through to
 * "Working system built on <term>", which is a technology dropped into a
 * sentence and reads as one: a Prompt Engineer got "Working system built on
 * prompt evaluation", and a Technical Writer got the same wording about
 * information architecture.
 *
 * So each position has its own. They are written to the same specification as
 * the shared ones — production-shaped rather than tutorial-shaped, ending in
 * evidence, and asserting no number the student has not measured — and stored
 * in the same three pieces, so an employer's substrate splices into them and a
 * title's lens closes them exactly as it does everywhere else.
 *
 * The non-engineering positions get real work rather than a diluted
 * engineer's: a Technical Writer's project is an API reference generated from
 * the schema with broken examples failing CI, a UX Researcher's is a study
 * with its tasks fixed before recruiting, a Scrum Master's is a measured
 * delivery flow with the intervention that moved it.
 *
 * Generated by tools/buildRoleBriefs.js.
 *
 * [ position, [ [ term, artefact, did, rest, defend, hours, steps ] ] ]
 */
const ROLE_BRIEFS = [
${lines}
];

const BY_ROLE = Object.fromEntries(ROLE_BRIEFS.map(([role, projects]) => [
  role.toLowerCase(),
  projects.map(([term, artefact, did, rest, defend, hours, steps]) =>
    ({ term, artefact, did, rest, defend, hours, steps })),
]));

const norm = (s) => String(s || '').toLowerCase().trim();

/**
 * The project this position has written for this term, or null.
 *
 * Matched on the term exactly, because these are written FOR that term — a
 * loose match would hand a Data Analyst's dashboard project to anything with
 * the word "data" in it, which is how the bucket tables got it wrong in the
 * first place.
 */
function briefFor(role, term) {
  const list = BY_ROLE[norm(role)] || lookup(role);
  if (!list) return null;
  const t = norm(term);
  return list.find((p) => p.term === t) || null;
}

function lookup(role) {
  const n = norm(role);
  if (!n) return null;
  // eslint-disable-next-line global-require
  const { matchPosition } = require('./careerData');
  const hit = matchPosition(n);
  return hit ? BY_ROLE[norm(hit)] || null : null;
}

/** Every project written for a position, in the order they were written. */
function briefsFor(role) {
  return BY_ROLE[norm(role)] || lookup(role) || [];
}

module.exports = { ROLE_BRIEFS, BY_ROLE, briefFor, briefsFor };
`;

const dest = path.join(__dirname, '..', 'services', 'v2', 'roleBriefs.js');
fs.writeFileSync(dest, out, 'utf8');
console.log(`wrote ${dest}: ${POSITIONS.length} positions, ${total} projects`);
