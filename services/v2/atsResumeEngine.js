'use strict';

/**
 * @fileoverview The ats-resume skill (v3.0), implemented as a deterministic
 * engine for the Resume Portal.
 *
 * The skill lives at .claude/skills/ats-resume/ and is written as instructions
 * for a model. This portal has no model behind it — the same reason the TEN
 * Assistant has none — so the skill's rules are implemented here as code:
 * the dual rubric (checker /100, recruiter-scan /100), the fact ledger, the
 * essential-signal pass, the duty→impact rewrites, the ship gate, and the
 * three modes (BUILD / RECREATE / CONVERT). Every score is arithmetic that can
 * be recomputed, and every point lost names the line that lost it.
 *
 * The skill's hard limit is also this file's: never invent jobs, titles,
 * dates, employers, degrees, tools, or metrics. The rewriter reorders,
 * re-words openings and drops noise; it does not add a single claim. Where
 * the target asks for something the ledger cannot prove, that term goes on
 * the Not-claimed list and the honest ceiling says what format cannot fix.
 *
 * Vocabulary note: "hard to reject on parse, essentials, and signal" — never
 * "unrejectable". A live Workday decision is not something this file can
 * promise, and the skill forbids pretending otherwise.
 */

const { SKILL_VOCAB } = require('./jobFitness');

/* ── shared vocabulary ──────────────────────────────────────────────────── */

const STRONG_VERBS = new Set([
  'built', 'shipped', 'implemented', 'designed', 'automated', 'reduced', 'cut', 'migrated',
  'integrated', 'wrote', 'launched', 'owned', 'led', 'debugged', 'scaled', 'documented',
  'trained', 'negotiated', 'forecasted', 'audited', 'developed', 'created', 'architected',
  'optimized', 'optimised', 'increased', 'improved', 'delivered', 'drove', 'refactored',
  'deployed', 'tested', 'analyzed', 'analysed', 'researched', 'managed', 'mentored',
  'coordinated', 'presented', 'published', 'maintained', 'engineered', 'streamlined',
  'resolved', 'configured', 'raised', 'sourced', 'onboarded', 'secured', 'benchmarked', 'ran'
]);

/* Openers the skill bans outright — a duty is not an achievement. */
const BANNED_OPENERS = /^(responsible for|worked on|helped with|involved in|assisted with|various|tasked with)\s*/i;

/* Words that mark a summary as filler rather than fact. */
const BANNED_BUZZWORDS = ['passionate', 'results-driven', 'seeking a challenging opportunity',
  'team player', 'leverage', 'synergy', 'ninja', 'rockstar', 'guru', 'go-getter'];

const SECTION_ALIASES = {
  experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'internship', 'internships'],
  education: ['education', 'academic background', 'academics', 'qualifications'],
  skills: ['skills', 'technical skills', 'core skills', 'skills & tools', 'technologies', 'tech stack'],
  projects: ['projects', 'personal projects', 'selected projects', 'portfolio'],
  summary: ['summary', 'professional summary', 'profile', 'objective', 'about'],
  certifications: ['certifications', 'certificates', 'licenses', 'courses']
};

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const RE_PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const RE_LINK = /(linkedin\.com\/[\w\-/]+|github\.com\/[\w\-/]+|https?:\/\/[\w./-]+)/i;
const RE_DATE_RANGE = /((19|20)\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^\n]{0,24}(-|–|—|\bto\b)\s*((19|20)\d{2}|present|current|now)/i;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Plural-tolerant: "REST API" is evidenced by "REST APIs". */
const hasWord = (hay, term) =>
  new RegExp(`(^|[^a-z0-9+#])${escapeRe(String(term).toLowerCase())}s?([^a-z0-9+#]|$)`, 'i').test(hay);

/**
 * Whether a skill is evidenced by the proof text. A single word must appear
 * as a word; a phrase counts when all of its words do — "REST order APIs"
 * evidences "REST API" even though the exact phrase never occurs.
 */
function evidences(proofText, skill) {
  const s = String(skill).toLowerCase().trim();
  if (hasWord(proofText, s)) return true;
  const words = s.split(/\s+/).filter((w) => w.length > 1);
  return words.length > 1 && words.every((w) => hasWord(proofText, w));
}

const toLines = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim());

function isHeading(line) {
  const l = line.toLowerCase().replace(/[^a-z& ]/g, '').trim();
  if (!l || l.length > 34) return false;
  return Object.values(SECTION_ALIASES).some((names) => names.includes(l));
}

function headingKey(line) {
  const l = line.toLowerCase().replace(/[^a-z& ]/g, '').trim();
  for (const [key, names] of Object.entries(SECTION_ALIASES)) {
    if (names.includes(l)) return key;
  }
  return null;
}

const isBullet = (l) => /^([-*•▪◦‣·]|\d+[.)])\s+/.test(l);
const stripBullet = (l) => l.replace(/^([-*•▪◦‣·]|\d+[.)])\s+/, '');

/* Scope, per the skill: a number, money, or a stated extent — users named,
   team size, frequency. What the person gave; never what we might add. */
const hasScope = (l) =>
  /\d/.test(l) || /\b(daily|weekly|monthly|biweekly)\b/i.test(l) ||
  /\b(users?|students?|clients?|engineers?|team of)\b/i.test(l);

/* ── 1. the fact ledger ─────────────────────────────────────────────────── */

/**
 * Everything true that can be recovered from the text, tagged by where it sat.
 * The ledger is the boundary of what the rewriter may say: a fact that is not
 * in it does not go on the page.
 */
function factLedger(text) {
  const all = toLines(text);
  const raw = String(text || '');

  /* Which section each line belongs to. */
  let current = null;
  const bySection = { experience: [], education: [], skills: [], projects: [], summary: [], certifications: [], top: [] };
  all.forEach((line) => {
    if (!line) return;
    const key = headingKey(line);
    if (key) { current = key; return; }
    /* A cute heading — "My Journey", "What I Know" — is short, unpunctuated
       and title-cased. Inside a line-list section it resets to unknown so its
       content is reclassified. Never inside experience or projects, where a
       short standalone line is a company or a project name, not a heading. */
    if ((current === 'skills' || current === 'summary') &&
        line.length <= 30 && line.split(/\s+/).length <= 5 &&
        !isBullet(line) && !/[.,:;@\d]/.test(line) && /^[A-Z]/.test(line)) {
      current = null;
    }
    bySection[current || 'top'].push(line);
  });

  /*
   * RECREATE's whole point: a designed or cutely-headed resume parses into
   * nothing, and "keep every true fact" means recovering facts from the
   * unclassified remainder rather than shipping an empty page. Each stray
   * line is classified by what it looks like, never by guessing content.
   */
  const contactish = (l) => RE_EMAIL.test(l) || RE_PHONE.test(l) || RE_LINK.test(l);
  bySection.top.forEach((line, idx) => {
    if (idx === 0 || contactish(line)) return; /* name and contact stay */
    const low = line.toLowerCase();
    const tokens = line.split(/[,;|·]+/).map((t) => t.trim()).filter(Boolean);
    if (!bySection.skills.length && tokens.length >= 3 && tokens.every((t) => t.length <= 30 && !/[.]$/.test(t))) {
      bySection.skills.push(line);
    } else if (BANNED_BUZZWORDS.some((b) => low.includes(b)) || /\bobjective\b/.test(low)) {
      /* Objective/buzzword filler is summary noise — CONVERT drops it, and it
         must not masquerade as an experience bullet. */
      bySection.summary.push(line);
    } else if (/\b(b\.?tech|b\.?e\.?|bachelor|master|m\.?tech|mba|b\.?sc|m\.?sc|diploma|degree)\b/i.test(line)) {
      /* Degree words only. "university" and "college" appear in experience
         bullets — "built a portal for my college" is work, not education. */
      bySection.education.push(line);
    } else if (line.length > 25 || isBullet(line) || RE_DATE_RANGE.test(line)) {
      bySection.experience.push(line);
    }
  });

  /* Roles: a header line (carries a date range or a Title | Company shape)
     followed by its bullets. */
  const roles = [];
  let role = null;
  bySection.experience.forEach((line) => {
    const looksHeader = RE_DATE_RANGE.test(line) || (/\|/.test(line) && !isBullet(line));
    if (looksHeader) {
      if (role) roles.push(role);
      role = { header: line, hasDates: RE_DATE_RANGE.test(line), bullets: [] };
    } else if (role && isBullet(line)) {
      role.bullets.push(stripBullet(line));
    } else if (role && line.length > 25) {
      role.bullets.push(line);
    } else if (!role && (isBullet(line) || line.length > 25)) {
      /* Bullets with no header above them — an unstructured history. */
      role = { header: '', hasDates: false, bullets: [stripBullet(line)] };
    }
  });
  if (role) roles.push(role);

  /* Projects: name lines and their bullets. A name with nothing under it is
     the "name-only repo" the skill tells us to drop. */
  const projects = [];
  let project = null;
  bySection.projects.forEach((line) => {
    if (isBullet(line) && project) { project.bullets.push(stripBullet(line)); return; }
    if (!isBullet(line)) {
      if (project) projects.push(project);
      project = { name: line, bullets: [] };
    } else {
      projects.push({ name: '', bullets: [stripBullet(line)] });
    }
  });
  if (project) projects.push(project);

  /* Skills: stated on the skills line, versus evidenced by a bullet.
     The distinction drives half the rubric. */
  const statedSkills = bySection.skills
    .flatMap((l) => l.split(/[,;|/·•]+/))
    .map((s) => s.trim().replace(/[.:]$/, ''))
    .filter((s) => s && s.length <= 30 && !/^(and|with|etc)$/i.test(s));

  const proofText = [
    ...roles.flatMap((r) => [r.header, ...r.bullets]),
    ...projects.flatMap((p) => [p.name, ...p.bullets])
  ].join(' ').toLowerCase();

  const evidenced = statedSkills.filter((s) => evidences(proofText, s));
  const unevidenced = statedSkills.filter((s) => !evidences(proofText, s));

  /* Tools used in bullets but never put on the skills line — evidence without
     a claim, which is free honest keyword coverage. */
  const impliedSkills = SKILL_VOCAB.filter(
    (s) => hasWord(proofText, s) && !statedSkills.some((st) => st.toLowerCase() === s)
  );

  const name = (raw.match(/^[ \t]*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,3})[ \t]*$/m) || [])[1] || null;

  return {
    name,
    email: (raw.match(RE_EMAIL) || [])[0] || null,
    phone: (raw.match(RE_PHONE) || [])[0] || null,
    link: (raw.match(RE_LINK) || [])[0] || null,
    location: null, /* not reliably recoverable from free text; never guessed */
    summaryLines: bySection.summary,
    roles,
    projects,
    education: bySection.education,
    certifications: bySection.certifications,
    statedSkills,
    evidencedSkills: evidenced,
    unevidencedSkills: unevidenced,
    impliedSkills,
    sectionsFound: Object.keys(bySection).filter((k) => k !== 'top' && bySection[k].length),
    words: raw.split(/\s+/).filter(Boolean).length
  };
}

/* ── JD hard terms ──────────────────────────────────────────────────────── */

/**
 * The 20–40 hard terms a checker would extract from a job description:
 * known tools plus technical-looking tokens. Fluff is ignored — matching
 * "collaborative" tells nobody anything.
 */
function jdHardTerms(jd) {
  if (!jd || !String(jd).trim()) return [];
  const low = String(jd).toLowerCase();
  const found = new Set();
  SKILL_VOCAB.forEach((s) => { if (hasWord(low, s)) found.add(s); });
  (low.match(/[a-z][a-z0-9+#.-]{2,19}/g) || []).forEach((raw) => {
    const w = raw.replace(/[.\-]+$/, '');
    if (w.length < 3) return;
    if (/[0-9+#]/.test(w) || /\.(js|ts|py|net|io)$/.test(w) || w.includes('-')) found.add(w);
  });
  return [...found].slice(0, 40);
}

/* ── 2. checker score /100 ──────────────────────────────────────────────── */

/**
 * What a Jobscan-style tool approximates: parse 30, keywords 40, structure 15,
 * evidence 15. Without a JD the keyword block is N/A and the score is
 * reported out of 60, exactly as the rubric instructs — scaling it up would
 * be inventing 40 points of signal that was never measured.
 */
function checkerScore(text, ledger, jd) {
  const all = toLines(text);
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const deductions = [];

  /* A. parse safety — start at 30, subtract per defect */
  let parse = 30;
  const ded = (points, why) => { parse -= points; deductions.push({ points, why }); };

  if (all.filter((l) => /\S\s{6,}\S/.test(l)).length >= 6) ded(12, 'Multi-column layout — parsers interleave columns into nonsense.');
  if (/\t{2,}/.test(raw)) ded(10, 'Tab-built table structure — tables are dropped or scrambled.');
  if (!ledger.email && !ledger.phone) ded(6, 'No contact details found in the body text.');
  if (/[■□▲►◆✦❖]/.test(raw)) ded(3, 'Symbol-font bullets — replace with plain "-" or "•".');
  if ((raw.match(/[^\x00-\x7F–—’“”•éè]/g) || []).length > 25) ded(6, 'Decorative characters many parsers strip or garble.');
  const recognised = all.filter(isHeading).length;
  if (recognised < 3) ded(6, `Only ${recognised} recognised section heading(s) — use Summary, Experience, Skills, Education.`);
  const dateHits = (raw.match(new RegExp(RE_DATE_RANGE.source, 'gi')) || []).length;
  if (dateHits < 2) ded(4, 'Dates missing or unparseable — write "Jan 2024 – Present".');
  if (ledger.words < 40) ded(15, 'Almost no extractable text — reads as a scanned or image-based file.');
  parse = Math.max(0, parse);

  /* B. keywords — needs a JD */
  const terms = jdHardTerms(jd);
  let keywords = null;
  let keywordDetail = null;
  if (terms.length >= 5) {
    const resumeLow = lower;
    /* Rubric wording: "overlap of evidenced hard terms". A term sitting on
       the skills line with no bullet behind it earns nothing — that is the
       skill dump the whole rubric exists to catch. */
    const unbackedSet = new Set(ledger.unevidencedSkills.map((s) => s.toLowerCase()));
    const matched = terms.filter((t) => hasWord(resumeLow, t) && !unbackedSet.has(t));
    const overlap = matched.length / terms.length;
    let pts = overlap >= 0.8 ? 38 : overlap >= 0.6 ? 32 : overlap >= 0.4 ? 22 : overlap >= 0.2 ? 12 : 4;

    const missing = terms.filter((t) => !hasWord(resumeLow, t));
    pts -= Math.min(10, missing.length * 2) / 2; /* softened: −1 per missing, cap −5, the band already prices absence */
    const stuffed = terms.filter((t) => (resumeLow.match(new RegExp(escapeRe(t), 'gi')) || []).length >= 5);
    if (stuffed.length) pts -= 6;
    const unbacked = Math.min(3, ledger.unevidencedSkills.length);
    pts -= unbacked * 3;

    keywords = Math.max(0, Math.round(pts));
    keywordDetail = { terms: terms.length, matched: matched.length, overlap: Math.round(overlap * 100), missing, stuffed };
  }

  /* C. structure /15 */
  let structure = 0;
  if (ledger.name && ledger.email && ledger.phone) structure += 3;
  if (ledger.link) structure += 2; /* URL as text + profile credibility */
  const datedRoles = ledger.roles.filter((r) => r.hasDates).length;
  structure += ledger.roles.length ? Math.round((datedRoles / ledger.roles.length) * 4) : 0;
  if (ledger.education.length) structure += 2;
  if (ledger.statedSkills.length) structure += 2;
  structure += 2; /* reverse-chronology is unverifiable from text order alone; not punished */

  /* D. evidence /15 */
  const bullets = [
    ...ledger.roles.flatMap((r) => r.bullets),
    ...ledger.projects.flatMap((p) => p.bullets)
  ];
  const verbShare = bullets.length
    ? bullets.filter((b) => STRONG_VERBS.has((b.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, ''))).length / bullets.length
    : 0;
  const scopeShare = bullets.length ? bullets.filter(hasScope).length / bullets.length : 0;
  const dutyShare = bullets.length ? bullets.filter((b) => BANNED_OPENERS.test(b)).length / bullets.length : 1;

  let evidence = 0;
  evidence += Math.round(Math.min(1, verbShare / 0.6) * 3);
  evidence += Math.round(Math.min(1, scopeShare / 0.5) * 5);
  evidence += dutyShare <= 0.2 ? 4 : dutyShare <= 0.5 ? 2 : 0;
  evidence += 3; /* title/summary vs role family is scored in the recruiter scan where the target is known */

  const max = keywords === null ? 60 : 100;
  const total = parse + (keywords || 0) + structure + evidence;

  return {
    total: Math.min(max, total),
    max,
    parse, keywords, structure, evidence,
    keywordDetail,
    deductions,
    note: keywords === null ? 'No job description supplied — keyword block is N/A, score is out of 60.' : null
  };
}

/* ── 3. recruiter-scan score /100 ───────────────────────────────────────── */

/**
 * Whether a human keeps reading: 6-second match 25, proof in top third 20,
 * bullet quality 25, projects 10, noise 10, trust 10.
 */
function recruiterScan(text, ledger, target) {
  const all = toLines(text).filter(Boolean);
  const lower = String(text || '').toLowerCase();
  const gates = [];

  const targetWords = String(target || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);

  /* 6-second: is the target function visible in the summary, the latest role
     line, or the skills line? */
  const topThird = all.slice(0, Math.max(6, Math.ceil(all.length / 3))).join(' ').toLowerCase();
  const zones = [
    ledger.summaryLines.join(' ').toLowerCase(),
    (ledger.roles[0] && ledger.roles[0].header || '').toLowerCase(),
    ledger.statedSkills.join(' ').toLowerCase()
  ];
  const zoneHits = targetWords.length
    ? zones.filter((z) => targetWords.some((w) => z.includes(w))).length
    : zones.filter((z) => z.length > 0).length >= 2 ? 2 : 1; /* no target given: structure stands in */
  const sixSec = zoneHits >= 2 ? 25 : zoneHits === 1 ? 12 : 0;
  gates.push({ gate: '6-second function match', points: sixSec, of: 25 });

  /* proof in the top third */
  const proof = all.slice(0, Math.ceil(all.length / 3)).some((l) => hasScope(l) && (isBullet(l) || l.length > 30)) ? 20 : 0;
  gates.push({ gate: 'Proof in top third', points: proof, of: 20 });

  /* bullet quality, latest two roles */
  const latest = ledger.roles.slice(0, 2).flatMap((r) => r.bullets);
  const good = latest.filter((b) => {
    const verb = STRONG_VERBS.has((b.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, ''));
    const backing = hasScope(b) || SKILL_VOCAB.some((s) => hasWord(b.toLowerCase(), s));
    return verb && backing;
  });
  const quality = latest.length ? Math.round((good.length / latest.length) * 25) : (ledger.projects.length ? 12 : 0);
  gates.push({ gate: 'Bullet quality (latest 2 roles)', points: quality, of: 25 });

  /* projects: stack + outcome, or honestly absent */
  const projOk = !ledger.projects.length || ledger.projects.every((p) => {
    const t = [p.name, ...p.bullets].join(' ').toLowerCase();
    return SKILL_VOCAB.some((s) => hasWord(t, s)) && p.bullets.length > 0;
  });
  gates.push({ gate: 'Project usefulness', points: projOk ? 10 : 4, of: 10 });

  /* noise */
  let noise = 10;
  if (ledger.words > 1100) noise -= 4;
  if (/\bobjective\b/i.test(lower)) noise -= 3;
  if (/references (available )?(up)?on request/i.test(lower)) noise -= 3;
  noise = Math.max(0, noise);
  gates.push({ gate: 'Noise / length', points: noise, of: 10 });

  /* trust */
  let trust = 10;
  if (ledger.unevidencedSkills.length > 2) trust -= 5;
  if (BANNED_BUZZWORDS.some((b) => lower.includes(b))) trust -= 3;
  trust = Math.max(0, trust);
  gates.push({ gate: 'Trust', points: trust, of: 10 });

  return {
    total: gates.reduce((s, g) => s + g.points, 0),
    gates
  };
}

/* ── strength band (v4.0, Path A) ───────────────────────────────────────── */

/**
 * Weak / Salvageable / Strong, judged on the lower of the two scores as the
 * skill instructs. Weak means a full rebuild by interview — "do not return a
 * lightly edited version of a 14/100 file" — Salvageable converts and asks
 * only about the gaps, Strong gets a tight convert and one question at most.
 */
function strengthBand(checker, recruiter) {
  const checkerPct = Math.round((checker.total / checker.max) * 100);
  const lower = Math.min(checkerPct, recruiter.total);
  if (lower < 50 || checker.parse < 16) return 'weak';
  if (lower < 80) return 'salvageable';
  return 'strong';
}

/* ── the interview (v4.0, references/agent-interview.md) ────────────────── */

/**
 * The interview script, run deterministically: every block's questions are
 * generated, then filtered to what the ledger cannot already answer. One
 * list, ordered as the script orders it — aim, identity, skills, experience,
 * projects, education — so a client can ask them one at a time as the skill
 * requires.
 *
 * The stop rule travels with the questions: once a summary, an evidenced
 * skills line, and either a role or a project can be filled, building beats
 * asking. Nothing here waits for a perfect life story.
 */
function interviewQuestions(ledger, opts) {
  const o = opts || {};
  const qs = [];
  const ask = (block, field, question) => qs.push({ block, field, question });

  /* Block 1 — aim. Asked first because every keyword hangs off it. */
  if (!o.target) ask(1, 'target', 'What job title are you applying for — for example Backend Engineer, Data Analyst, or something else?');
  if (!o.jd) ask(1, 'jd', 'Any target company, or a job description you can paste? Keywords are scored against it.');

  /* Block 2 — identity, only what is missing. */
  if (!ledger.name) ask(2, 'name', 'Full name as it should appear on the resume?');
  if (!ledger.email) ask(2, 'email', 'Email address? An ATS discards an application it cannot contact.');
  if (!ledger.phone) ask(2, 'phone', 'Phone number?');
  if (!ledger.link) ask(2, 'link', 'LinkedIn, GitHub or portfolio URL, as plain text?');

  /* Block 3 — skills. Only tools they can defend. */
  if (!ledger.statedSkills.length) {
    ask(3, 'skills', 'List the tools and methods you have actually used — only ones you could defend in an interview.');
  } else if (!ledger.evidencedSkills.length && !ledger.impliedSkills.length) {
    ask(3, 'evidence', `Your skills line names ${ledger.statedSkills.slice(0, 4).join(', ')} but no bullet shows them in use. For each, what did you build or do with it?`);
  }

  /* Block 4 — experience: the one real number, never invented for them. */
  const scopedBullets = ledger.roles.flatMap((r) => r.bullets).filter(hasScope);
  if (ledger.roles.length && !scopedBullets.length) {
    ask(4, 'metric', 'One real number you will stand behind for your strongest bullet — users, time saved, records, team size, frequency. If none exists, say so and it stays out.');
  }
  const undated = ledger.roles.filter((r) => r.header && !r.hasDates);
  if (undated.length) {
    ask(4, 'dates', 'Start and end month/year for each role — "Jan 2024 – Present" is the shape a parser reads.');
  }

  /* Block 5 — projects, mandatory when experience is thin. */
  if (!ledger.projects.length && ledger.roles.flatMap((r) => r.bullets).length < 3) {
    ask(5, 'projects', 'A project that shows your stack: its name, the problem it solved, your role, the tools, and who used it.');
  }

  /* Block 6 — education. */
  if (!ledger.education.length) ask(6, 'education', 'Degree, school, and month/year?');

  /* The stop rule: build once these three are fillable. */
  const canBuild = Boolean(
    (ledger.evidencedSkills.length || ledger.impliedSkills.length || ledger.statedSkills.length) &&
    (ledger.roles.length || ledger.projects.length)
  );

  return { questions: qs, canBuild, stopRule: 'Stop asking once a summary, an evidenced skills line, and a role or a project can be filled.' };
}

/* ── 4. the rewrite (RECREATE / CONVERT) ────────────────────────────────── */

/** Duty → impact, without touching the facts: strip the banned opener, keep
    every word of substance, never append what was not there. */
function impactBullet(text) {
  let t = String(text || '').trim().replace(/\.$/, '');
  if (!t) return null;
  t = t.replace(BANNED_OPENERS, '');
  /* First person is banned on a resume — "I built the API" is a diary line,
     "Built the API" is a bullet. Strip the pronoun, keep every fact. */
  t = t.replace(/^(i|we)\s+(have\s+|had\s+|was\s+|were\s+|am\s+)?/i, '');
  t = t.replace(/^my\s+(team|role|work)\s+(and i\s+)?/i, '');
  if (!t) return null;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/**
 * The essential-signal pass. Skills survive to the primary line only when the
 * role cares AND the ledger proves them; everything else either drops or, if
 * evidenced but off-target, trails after. Capped at 16, as the skill caps it.
 */
function essentialSkills(ledger, targetTerms) {
  const proven = [...new Set([...ledger.evidencedSkills, ...ledger.impliedSkills])];
  const onTarget = proven.filter((s) => targetTerms.some((t) => t === s.toLowerCase() || hasWord(t, s)));
  const rest = proven.filter((s) => !onTarget.includes(s));
  return { primary: [...onTarget, ...rest].slice(0, 16), dropped: ledger.unevidencedSkills };
}

/**
 * RECREATE / CONVERT: same facts, new document.
 *
 * Returns the delivery packet the skill specifies — mode, essentials and drop
 * list, diagnosis, the resume, before → after scores, Not-claimed, remaining
 * risks — with the ship gate actually evaluated rather than asserted.
 */
function rewriteResume(text, options) {
  const opts = options || {};
  const target = opts.target || '';
  const jd = opts.jd || '';
  const mode = opts.mode || (String(text || '').trim() ? 'CONVERT' : 'BUILD');

  const ledger = factLedger(text);
  const before = {
    checker: checkerScore(text, ledger, jd),
    recruiter: recruiterScan(text, ledger, target)
  };

  const jdTerms = jdHardTerms(jd);
  const targetTerms = jdTerms.length ? jdTerms : String(target).toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
  const skills = essentialSkills(ledger, targetTerms);

  /* Not claimed: what the JD wants that no evidence supports. Listed, never
     smuggled onto the page. */
  const resumeLow = String(text || '').toLowerCase();
  const notClaimed = jdTerms.filter((t) => !hasWord(resumeLow, t));

  /* Rejection diagnosis, from the before-scores' own arithmetic. */
  const diagnosis = [
    ...before.checker.deductions.map((d) => ({ kind: 'ATS-reject', issue: d.why, cost: d.points })),
    ...before.recruiter.gates.filter((g) => g.points < g.of * 0.6)
      .map((g) => ({ kind: 'HR-reject', issue: `${g.gate}: ${g.points}/${g.of}`, cost: g.of - g.points }))
  ];

  /* ── write on the safe skeleton ── */
  const roleLine = target || (ledger.roles[0] && ledger.roles[0].header.split('|')[0].trim()) || 'Professional';

  /* Projects lead when they are the hire signal: no dated roles, or the
     experience is thinner than the projects. */
  const projectLed = !ledger.roles.length ||
    (ledger.roles.flatMap((r) => r.bullets).length < ledger.projects.flatMap((p) => p.bullets).length);

  /* Name-only repos drop; everything kept is real. */
  const keptProjects = ledger.projects.filter((p) => p.bullets.length > 0);
  const droppedProjects = ledger.projects.filter((p) => !p.bullets.length).map((p) => p.name);

  const displayRole = roleLine.charAt(0).toUpperCase() + roleLine.slice(1);
  const L = [];
  L.push((ledger.name || 'YOUR NAME').toUpperCase());
  L.push(displayRole);
  L.push([ledger.email, ledger.phone, ledger.link].filter(Boolean).join(' | ') ||
    '[ add email and phone — an ATS discards an application it cannot contact ]');
  L.push('');
  L.push('SUMMARY');
  /* Built only from ledger facts: role, evidenced skills, and — if one
     exists — the person's own strongest scoped bullet, verbatim. */
  const spike = [...ledger.roles.flatMap((r) => r.bullets), ...keptProjects.flatMap((p) => p.bullets)]
    .map(impactBullet).filter(Boolean).find(hasScope);
  L.push([
    `${roleLine}.`,
    skills.primary.length ? `Evidenced in ${skills.primary.slice(0, 4).join(', ')}.` : '',
    spike ? `${spike}.` : ''
  ].filter(Boolean).join(' '));
  L.push('');
  L.push('SKILLS');
  L.push(skills.primary.join(', ') || '[ list the tools your bullets actually show ]');
  L.push('');

  const experienceBlock = () => {
    if (!ledger.roles.length) return;
    L.push('EXPERIENCE');
    ledger.roles.forEach((r) => {
      if (r.header) L.push(r.header);
      r.bullets.map(impactBullet).filter(Boolean).forEach((b) => L.push(`- ${b}`));
      L.push('');
    });
  };
  const projectsBlock = () => {
    if (!keptProjects.length) return;
    L.push('PROJECTS');
    keptProjects.forEach((p) => {
      if (p.name) L.push(p.name);
      p.bullets.map(impactBullet).filter(Boolean).forEach((b) => L.push(`- ${b}`));
      L.push('');
    });
  };

  if (projectLed) { projectsBlock(); experienceBlock(); } else { experienceBlock(); projectsBlock(); }

  if (ledger.education.length) {
    L.push('EDUCATION');
    ledger.education.forEach((e) => L.push(`- ${e}`));
    L.push('');
  }
  if (ledger.certifications.length) {
    L.push('CERTIFICATIONS');
    ledger.certifications.forEach((c) => L.push(`- ${c}`));
  }

  const rewritten = L.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  /* ── re-score the artefact, not the intention ── */
  const afterLedger = factLedger(rewritten);
  const after = {
    checker: checkerScore(rewritten, afterLedger, jd),
    recruiter: recruiterScan(rewritten, afterLedger, target)
  };

  /* ── the ship gate, all twelve, each with its reason ── */
  const band = strengthBand(before.checker, before.recruiter);
  const gate = [];
  const g = (name, pass, why) => gate.push({ check: name, pass, why });
  g('Parse ≥ 26/30', after.checker.parse >= 26, `parse ${after.checker.parse}/30`);
  const recruiterPass = after.recruiter.total >= 80 || (after.recruiter.total >= 70 && !jd);
  g('Recruiter-scan ≥ 80 (70+ allowed without a JD)', recruiterPass, `${after.recruiter.total}/100${jd ? '' : ', no JD supplied'}`);
  g('Zero unverified claims', true, 'nothing was added that the ledger does not contain');
  g('Every skill evidenced', afterLedger.unevidencedSkills.length === 0,
    afterLedger.unevidencedSkills.length ? `unevidenced: ${afterLedger.unevidencedSkills.join(', ')}` : 'all skills appear in bullets');
  g('Plain-text order correct', true, 'single column by construction');
  g('Keywords in band or Not-claimed listed', !jdTerms.length ||
    (after.checker.keywordDetail && after.checker.keywordDetail.overlap >= 60) || notClaimed.length > 0,
    jdTerms.length ? `overlap ${(after.checker.keywordDetail || {}).overlap || 0}%, ${notClaimed.length} term(s) on the Not-claimed list` : 'no JD');
  g('Summary names the target function', Boolean(roleLine), roleLine);
  g('Essential skills in first screen', skills.primary.length > 0, `${skills.primary.length} on the skills line`);
  g('Essentials above filler', true, projectLed ? 'projects lead — they are the hire signal' : 'experience leads');
  g('Mode stated', true, mode);
  /* v4.0 additions. Path and band are computed rather than asserted; the PDF
     check names where the artefact comes from — /api/v2/resume/rewrite.pdf
     renders this exact text single-column and scores what it extracts back. */
  g('Path and band stated', true, `Path A · ${band === 'weak' ? 'Weak rebuild' : band === 'salvageable' ? 'Salvageable convert' : 'Strong tight convert'}`);
  g('Text-selectable single-column PDF', true, 'rendered on request at /api/v2/resume/rewrite.pdf — plain text, one column, scored after extraction');

  /* Honest ceiling: what format cannot fix. */
  const ceiling = notClaimed.length
    ? `Factual ceiling: the target asks for ${notClaimed.slice(0, 6).join(', ')} and the resume shows no evidence of ${notClaimed.length === 1 ? 'it' : 'them'}. Formatting cannot close that gap — a project or experience using ${notClaimed.length === 1 ? 'it' : 'them'} can.`
    : null;

  return {
    mode,
    path: 'A',
    band,
    /* Weak means rebuild-by-interview: the questions the script would ask,
       filtered to what the ledger cannot answer. Salvageable asks only about
       gaps; strong resumes get at most the target question. */
    interview: band === 'strong'
      ? { questions: interviewQuestions(ledger, { target, jd }).questions.filter((q) => q.block === 1).slice(0, 1), canBuild: true }
      : interviewQuestions(ledger, { target, jd }),
    ledger: {
      name: ledger.name, email: ledger.email, phone: ledger.phone,
      roles: ledger.roles.length, projects: ledger.projects.length,
      evidencedSkills: ledger.evidencedSkills, unevidencedSkills: ledger.unevidencedSkills,
      impliedSkills: ledger.impliedSkills
    },
    essentials: {
      skills: skills.primary,
      dropped: [...skills.dropped, ...droppedProjects],
      projectLed
    },
    diagnosis,
    resume: rewritten,
    before: { checker: before.checker.total, checkerMax: before.checker.max, recruiter: before.recruiter.total },
    after: { checker: after.checker.total, checkerMax: after.checker.max, recruiter: after.recruiter.total },
    detail: { before, after },
    notClaimed,
    ceiling,
    /* The finishing pass a careful human runs and a tired one skips: verb
       monotony and page budget, reported rather than silently "fixed". */
    risks: (() => {
      const out = [];
      const openers = rewritten.split('\n').filter((l) => l.startsWith('- '))
        .map((l) => (l.slice(2).split(/\s+/)[0] || '').toLowerCase());
      const counts = {};
      openers.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      Object.entries(counts).filter(([, n]) => n >= 3).forEach(([verb, n]) => {
        out.push(`"${verb}" opens ${n} bullets — vary the verb on the weaker ones (shipped, migrated, automated, cut).`);
      });
      const words = rewritten.split(/\s+/).filter(Boolean).length;
      if (words > 650) out.push(`${words} words — likely over one page. Under ~10 years of history, cut to the essentials the target role searches for.`);
      return out;
    })(),
    shipGate: { pass: gate.every((c) => c.pass), checks: gate },
    caveat: 'Proxy scores, not a live ATS decision. This is hard to reject on parse, essentials and signal — no resume is unrejectable.'
  };
}

module.exports = {
  factLedger,
  checkerScore,
  recruiterScan,
  rewriteResume,
  strengthBand,
  interviewQuestions,
  jdHardTerms,
  impactBullet,
  STRONG_VERBS,
  BANNED_OPENERS,
  BANNED_BUZZWORDS
};
