'use strict';

/*
 * Writes services/v2/projectMatrix.js from the researched data.
 *
 * The two tables are long — 374 employers and 120 job titles — and hand-typing
 * them would be a week of transcription errors. This reads the researched JSON,
 * enforces the properties the engine relies on (every name known, every noun
 * unique, every lens unique), and emits the module. It is checked in so the
 * table can be regenerated rather than patched by hand.
 *
 *   node tools/buildProjectMatrix.js matrix-raw.json [fixes.json]
 */

const fs = require('fs');
const path = require('path');

const { COMPANIES } = require('../services/v2/aspirationalCompanies');
const { POSITIONS } = require('../services/v2/careerData');

const rawPath = process.argv[2] || 'matrix-raw.json';
const fixPath = process.argv[3] || '';

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const fixes = fixPath && fs.existsSync(fixPath)
  ? JSON.parse(fs.readFileSync(fixPath, 'utf8')).companies || []
  : [];

const clean = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const byName = new Map();
raw.companies.forEach((c) => byName.set(clean(c.name), {
  noun: clean(c.noun).toLowerCase(),
  subject: clean(c.subject).toLowerCase(),
  bar: clean(c.bar).toLowerCase(),
}));
fixes.forEach((c) => byName.set(clean(c.name), {
  noun: clean(c.noun).toLowerCase(),
  subject: clean(c.subject).toLowerCase(),
  bar: clean(c.bar).toLowerCase(),
}));

/* Every listed employer must have one, and only listed employers get one. */
const missing = COMPANIES.map(([n]) => n).filter((n) => !byName.has(n));
if (missing.length) {
  console.error(`no substrate for ${missing.length} employers: ${missing.slice(0, 12).join(', ')}`);
  process.exit(1);
}

/*
 * Uniqueness, enforced rather than hoped for.
 *
 * Two employers sharing a noun means two employers producing the identically
 * titled project, which is the exact fault this whole table exists to remove.
 * A survivor keeps what it was given; anything still colliding is suffixed
 * with a word from its own name, which is always true and always distinct.
 */
function forceUnique(field) {
  const seen = new Map();
  COMPANIES.forEach(([name]) => {
    const row = byName.get(name);
    const key = row[field];
    if (!seen.has(key)) { seen.set(key, name); return; }
    const own = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/)[0];
    /* The employer's own name plus the head of what it handles — "hero-parts",
       not "hero-spare-parts", because a title carries this word. */
    const head = String(key).split('-').pop();
    let candidate = field === 'noun'
      ? (head === own ? `${own}-${String(key).split('-')[0]}` : `${own}-${head}`)
      : `${key} at ${own}`;
    let n = 2;
    while (seen.has(candidate)) { candidate = `${candidate}-${n}`; n += 1; }
    row[field] = candidate;
    seen.set(candidate, name);
    console.error(`collision on ${field}: ${name} -> ${candidate}`);
  });
}
forceUnique('noun');
forceUnique('subject');

const roleByName = new Map();
raw.roles.forEach((r) => roleByName.set(clean(r.role), {
  lens: clean(r.lens).toLowerCase().replace(/\.$/, ''),
  terms: (r.terms || []).map((t) => clean(t).toLowerCase()).filter(Boolean),
  skills: (r.skills || []).map((t) => clean(t)).filter(Boolean),
}));

const missingRoles = POSITIONS.filter((p) => !roleByName.has(p));
if (missingRoles.length) {
  console.error(`no lens for ${missingRoles.length} positions: ${missingRoles.join(', ')}`);
  process.exit(1);
}

/* A lens shared by two titles is two titles producing the same bullet. */
const lensSeen = new Map();
POSITIONS.forEach((p) => {
  const row = roleByName.get(p);
  if (!lensSeen.has(row.lens)) { lensSeen.set(row.lens, p); return; }
  row.lens = `${row.lens}, as ${p.toLowerCase()} work is judged`;
  lensSeen.set(row.lens, p);
  console.error(`collision on lens: ${p}`);
});

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const companyLines = COMPANIES.map(([name]) => {
  const r = byName.get(name);
  return `  [${q(name)}, ${q(r.noun)}, ${q(r.subject)}, ${q(r.bar)}],`;
}).join('\n');

const roleLines = POSITIONS.map((p) => {
  const r = roleByName.get(p);
  return `  [${q(p)}, ${q(r.lens)},\n    [${r.terms.map(q).join(', ')}],\n    [${r.skills.map(q).join(', ')}]],`;
}).join('\n');

const out = `'use strict';

/**
 * What each employer's engineering is about, and what each job title is judged
 * on — the two facts that make one project brief into forty-four thousand
 * different projects.
 *
 * A brief describes a piece of engineering: shard a datastore, trace a request,
 * evaluate a retrieval system. On its own it is the same sentence for everyone,
 * and that is how a page aimed at Google ended up carrying the projects a page
 * aimed at a forty-person startup carried, and how a data scientist and a
 * backend engineer at the same company were told to build the same four things.
 *
 * Crossing the brief with these two tables fixes both directions at once. The
 * employer supplies the SUBSTRATE — the data or system its work is actually
 * about — so the same brief becomes a different project at a bank than at a
 * search company. The title supplies the LENS — what that job is measured on —
 * so the same brief at the same employer becomes a different project for a
 * backend engineer than for an SRE.
 *
 * On what this is NOT. Nobody publishes which candidate's projects got them
 * hired, so nothing here is derived from hiring outcomes and nothing claims to
 * be. What is public is what each business sells and therefore what its systems
 * hold; a portfolio project shaped like that work is the one that survives
 * being asked about in a room. None of it is ever written onto a page as a
 * claim about the employer — it shapes what the student is told to build.
 *
 * Generated by tools/buildProjectMatrix.js. Every noun and every subject is
 * unique across the ${COMPANIES.length} employers, and every lens is unique across the
 * ${POSITIONS.length} titles, because a duplicate anywhere here is two people handing in the
 * same project.
 */

/* [ employer, noun, subject, bar ] */
const SUBSTRATES = [
${companyLines}
];

/* [ title, lens, terms, skills ] */
const LENSES = [
${roleLines}
];

/*
 * The sector's substrate, for an employer nobody has written one for.
 *
 * The roster above is the employers a student aims at. The openings that come
 * back from the boards are mostly somebody else — a Berlin logistics firm, a
 * forty-person analytics shop — and they were falling through to the generic
 * wording, so two DevOps postings at two different companies produced the
 * identical page. That is the same fault the roster exists to fix, showing up
 * on the half of the list that has an actual job behind it.
 *
 * A sector is not as sharp as a name, and it is true: an unlisted bank is
 * still a bank, and a page aimed at one should talk about ledgers. The
 * employer's own name still leads the project title, so two unlisted banks
 * hiring the same role do not produce the same page either.
 *
 * [ domain, subject, bar ]
 */
const DOMAIN_SUBSTRATES = [
  ['software', 'a service and the records behind it', 'at the traffic a real product sees'],
  ['semiconductor', 'chip test and yield measurements', 'at tolerances where a false reading scraps a batch'],
  ['automotive', 'vehicle build and service records', 'across a fleet that reports intermittently'],
  ['aerospace', 'flight and test telemetry', 'under real-time deadlines where a dropped frame is unrecoverable'],
  ['fintech', 'payments and their settlement records', 'where a duplicate is real money'],
  ['networking', 'traffic flows across routed links', 'at line rate where a queue decision drops real traffic'],
  ['hardware', 'device fleets and their configuration', 'across units that must all come up identically'],
  ['finance', 'account ledgers and transaction history', 'under audit and reconciliation rules'],
  ['insurance', 'policies and claims records', 'under regulated timelines a claimant can appeal'],
  ['healthcare', 'patient records and clinical events', 'under access rules that log every read'],
  ['retail', 'orders, stock and returns', 'across stores where stock moves faster than reads'],
  ['fmcg', 'distributor stock and shipment records', 'across outlets restocked on a weekly cycle'],
  ['chemicals', 'batch process readings and quality tests', 'under batch tolerances that only show up later'],
  ['energy', 'meter readings and grid load', 'across assets that report on unreliable links'],
  ['infrastructure', 'project schedules and site progress records', 'across sites where the data arrives late and by hand'],
  ['industrial', 'machine telemetry and maintenance records', 'across machines that fail differently in each plant'],
  ['metals', 'production runs and quality measurements', 'under furnace tolerances measured after the fact'],
  ['telecom', 'subscriber sessions and network events', 'at subscriber volumes where a retry storm is an outage'],
  ['media', 'content catalogues and viewing events', 'at fanout where one release reaches everybody at once'],
  ['logistics', 'shipments and their delivery scans', 'across handoffs where a scan can be missed'],
  ['itservices', 'client delivery projects and their estates', 'across client estates with separate rules'],
  ['consulting', 'engagement findings and client data extracts', 'across clients whose data may never mix'],
  ['security', 'authentication and network telemetry', 'at alert volumes an on-call rota must triage'],
];

const DOMAIN = Object.fromEntries(DOMAIN_SUBSTRATES.map(([d, subject, bar]) => [d, { subject, bar }]));

/*
 * The sector an unlisted employer names in its own name.
 *
 * Falling back to the ROLE's sector put "a service and the records behind it"
 * on a page aimed at Deutsche Bank, which is a bank and says so in its name.
 * This reads the evidence the employer supplied and only then gives up and
 * asks the role. It is a guess either way; one of them is a guess with a
 * reason.
 *
 * Whole words, matched against the name's own tokens rather than by pattern:
 * a substring match makes "Bancorp" out of "Bancroft" and files a design
 * studio under retail banking.
 *
 * [ domain, words ]
 */
const NAME_WORDS = [
  ['finance', ['bank', 'bancorp', 'banca', 'banco', 'capital', 'securities', 'broking', 'brokerage', 'wealth', 'asset', 'fund', 'funds', 'investments']],
  ['insurance', ['insurance', 'assurance', 'insurers', 'reinsurance']],
  ['fintech', ['pay', 'payments', 'fintech', 'wallet', 'lending', 'credit', 'neobank']],
  ['healthcare', ['pharma', 'pharmaceuticals', 'biotech', 'healthcare', 'health', 'hospital', 'hospitals', 'clinic', 'clinics', 'diagnostics', 'medtech', 'medical', 'healthineers', 'therapeutics']],
  ['logistics', ['logistics', 'freight', 'shipping', 'courier', 'express', 'cargo', 'warehousing', 'delivery', 'transport']],
  ['automotive', ['motors', 'automotive', 'autos', 'vehicles', 'mobility', 'motocorp']],
  ['aerospace', ['aerospace', 'aviation', 'airlines', 'space', 'avionics', 'defence', 'defense']],
  ['semiconductor', ['semiconductor', 'semiconductors', 'microelectronics', 'silicon', 'foundry', 'fab']],
  ['metals', ['steel', 'metals', 'aluminium', 'aluminum', 'mining', 'minerals', 'alloys']],
  ['chemicals', ['chemicals', 'polymers', 'paints', 'fertilisers', 'fertilizers']],
  ['energy', ['energy', 'power', 'petroleum', 'petrochemicals', 'gas', 'solar', 'renewables', 'utilities', 'grid']],
  ['telecom', ['telecom', 'telecommunications', 'wireless', 'broadband', 'cellular']],
  ['media', ['media', 'studios', 'entertainment', 'broadcast', 'television', 'publishing', 'music', 'games', 'gaming']],
  ['retail', ['retail', 'stores', 'mart', 'commerce', 'bazaar', 'grocers', 'supermarket', 'supermarkets']],
  ['fmcg', ['foods', 'beverages', 'dairy', 'fmcg', 'breweries', 'consumer']],
  ['infrastructure', ['construction', 'infrastructure', 'cement', 'realty', 'builders', 'infra']],
  ['industrial', ['industries', 'industrial', 'manufacturing', 'machinery', 'equipment', 'works']],
  ['consulting', ['consulting', 'consultants', 'advisory', 'partners']],
  ['itservices', ['technologies', 'infotech', 'systems', 'solutions', 'informatics', 'consultancy']],
  ['security', ['security', 'cyber', 'cybersecurity', 'threat']],
  ['networking', ['networks', 'networking', 'routers']],
];

const WORD_DOMAIN = new Map();
NAME_WORDS.forEach(([domain, words]) => words.forEach((w) => {
  if (!WORD_DOMAIN.has(w)) WORD_DOMAIN.set(w, domain);
}));

const SUBSTRATE = Object.fromEntries(SUBSTRATES.map(([name, noun, subject, bar]) =>
  [name.toLowerCase(), { name, noun, subject, bar }]));

const LENS = Object.fromEntries(LENSES.map(([role, lens, terms, skills]) =>
  [role.toLowerCase(), { role, lens, terms, skills }]));

const norm = (s) => String(s || '').toLowerCase().trim();

/**
 * The substrate for an employer, by name.
 *
 * Loose on the tail because a posting writes "Google India", "Infosys Ltd" and
 * "Tata Consultancy Services (TCS)" for employers this table lists plainly. It
 * is deliberately NOT loose on the head: matching a prefix of what was typed
 * would turn every three-letter fragment into a large employer, and a student
 * would get a bank's projects because they applied somewhere beginning "HDF".
 */
function substrateFor(company, role) {
  const n = norm(company);
  if (!n) return null;
  if (SUBSTRATE[n]) return SUBSTRATE[n];
  const key = Object.keys(SUBSTRATE).find((k) =>
    n.startsWith(\`\${k} \`) || n === \`the \${k}\` || n.replace(/[.,()]/g, '').trim() === k);
  if (key) return SUBSTRATE[key];

  /*
   * An employer we do not hold: its sector, under its own name.
   *
   * The noun is the first word of the company, which is always true of them
   * and never true of anybody else, so two unlisted employers hiring the same
   * title still get different project titles. Anything below three letters is
   * refused — "AB Systems" would make a project called "Ab shard router",
   * which reads as a bug rather than as a company.
   */
  // eslint-disable-next-line global-require
  const { domainsFor } = require('./aspirationalCompanies');
  const own = n.replace(/[^a-z0-9 &-]/g, '').split(/\\s+/)[0];
  if (own.length < 3) return null;
  const named = n.split(/[^a-z0-9]+/).map((w) => WORD_DOMAIN.get(w)).find(Boolean);
  const dom = DOMAIN[named] || DOMAIN[(domainsFor(role) || [])[0]] || DOMAIN.software;
  return { name: company, noun: own, subject: dom.subject, bar: dom.bar, sector: true };
}

/**
 * The lens for a job title.
 *
 * Exact first, then the closest listed position, so "Sr. Backend Developer
 * (Payments)" lands on a real title rather than on nothing. A title that
 * matches nothing returns null and the caller falls back to wording that
 * mentions neither — silence beats aiming a page at the wrong job.
 */
function lensFor(role) {
  const n = norm(role);
  if (!n) return null;
  if (LENS[n]) return LENS[n];
  // eslint-disable-next-line global-require
  const { matchPosition } = require('./careerData');
  const hit = matchPosition(n);
  return hit && LENS[norm(hit)] ? LENS[norm(hit)] : null;
}

module.exports = {
  SUBSTRATES, LENSES, DOMAIN_SUBSTRATES, NAME_WORDS, SUBSTRATE, LENS, DOMAIN, substrateFor, lensFor,
};
`;

const dest = path.join(__dirname, '..', 'services', 'v2', 'projectMatrix.js');
fs.writeFileSync(dest, out, 'utf8');
console.log(`wrote ${dest}: ${COMPANIES.length} employers, ${POSITIONS.length} titles`);
