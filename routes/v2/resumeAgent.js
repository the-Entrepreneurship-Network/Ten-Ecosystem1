/*
 * The Resume Portal agent — scores a resume the way an ATS does, and builds
 * one that survives the same scoring.
 *
 * No language model and no API key, for the same reason the TEN Assistant has
 * none: a resume verdict that stops working when a quota runs out is worse
 * than no verdict, and a generated score can be confidently wrong. Applicant
 * tracking systems are not creative — they parse text, look for known section
 * headings, pull contact details, match keywords and give up on layouts they
 * cannot read. All of that is checkable here, deterministically, and every
 * point lost comes back with the exact line that lost it.
 *
 * Two capabilities, one engine:
 *   POST /api/v2/resume/scan   text or an uploaded PDF -> score + verdict + fixes
 *   POST /api/v2/resume/build  details -> a resume that scores itself before returning
 *   POST /api/v2/resume/chat   routes a chat turn to one of the above
 *
 * The builder is graded by the same scanner that grades an upload, so
 * "unrejectable" is a measured claim rather than a promise.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');

/* The ats-resume skill (v3.0, .claude/skills/ats-resume) as a deterministic
   engine: fact ledger, dual scoring, essential-signal pass, ship gate. */
const atsEngine = require('../../services/v2/atsResumeEngine');
const career = require('../../services/v2/careerData');
const interview = require('../../services/v2/resumeInterview');
const githubImport = require('../../services/v2/githubImport');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

/* The app mounts express.json() globally but not urlencoded, so a plain form
   post arrived with an empty body. Parsed here rather than globally: this
   section is additive and must not change how any existing route reads input.
   Multipart requests pass straight through to multer. */
router.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ── vocabulary ─────────────────────────────────────────────────────────── */

/*
 * A bullet as a PDF extractor leaves it. See the note in atsResumeEngine:
 * requiring a glyph-plus-space missed "•Managed", "– Managed" and Word's
 * "o Managed", which is how a resume with 32 achievements reported that none
 * of them opened with a verb.
 */
const BULLET_RE = /^\s*(?:[-*•▪◦‣·▸►●○◆■□➤➢‧⁃–—]+\s*|o\s+(?=[A-Z])|\d+[.)]\s*)/;

const ACTION_VERBS = [
  'built','designed','developed','led','shipped','launched','created','implemented','architected',
  'automated','optimized','optimised','reduced','increased','improved','migrated','integrated',
  'delivered','owned','drove','scaled','refactored','deployed','tested','analyzed','analysed',
  'researched','managed','mentored','coordinated','negotiated','presented','published','maintained',
  'engineered','streamlined','resolved','debugged','configured','modelled','modeled','forecasted',
  'raised','sourced','onboarded','trained','audited','secured','documented','benchmarked',
  'wrote','ran','achieved','collaborated','planned','simplified','rewrote','shipped','cut','saved',
  /* Missing from the list, so a bullet already opening with one of these got
     a second verb bolted on: "Automated added Redux state management". */
  'added','set','extended','ported','replaced','removed','fixed','converted','introduced','launched',
  'measured','instrumented','profiled','validated','verified','standardised','standardized',
  'consolidated','partnered','supported','facilitated','organised','organized','prototyped',
];

/* Headings an ATS recognises. Cute alternatives are the classic silent
   rejection: the parser cannot tell "Where I've Been" is employment history. */
const SECTION_ALIASES = {
  experience: ['experience','work experience','professional experience','employment','employment history','work history','internship','internships'],
  education:  ['education','academic background','academics','qualifications'],
  skills:     ['skills','technical skills','core skills','skills & tools','technologies','tech stack'],
  projects:   ['projects','personal projects','selected projects','portfolio'],
  summary:    ['summary','professional summary','profile','objective','about'],
  certifications: ['certifications','certificates','licenses','courses'],
};

/* Keyword banks per track — the fourteen TEN domains plus the roles students
   most often apply into. Used to report what a target job would look for. */
const ROLE_KEYWORDS = {
  'python': ['python','flask','django','rest api','pandas','numpy','oop','sql','git','unit testing'],
  'java': ['java','spring','spring boot','jdbc','collections','oop','maven','rest api','sql','junit'],
  'web': ['html','css','javascript','react','responsive','dom','git','api','accessibility','deployment'],
  'mern': ['mongodb','express','react','node','rest api','jwt','authentication','hooks','redux','socket'],
  'flutter': ['flutter','dart','widgets','state management','firebase','rest api','android','ios','animations'],
  /*
   * Backend has its own bank because it was folded into software engineering,
   * whose words are practices rather than tools. A backend resume listing
   * Python, AWS, Terraform, Docker, PostgreSQL and Kafka scored 0/9 and was
   * advised to add "clean code" and "design patterns" — phrases no ATS keys
   * on and no recruiter believes.
   */
  'backend': ['rest api','sql','database','docker','aws','testing','git','microservices','caching','authentication'],
  /* Languages belong here. A Java/HTML/CSS resume scored 0/9 against a bank of
     pure practice words, so the person was told their own stack was missing. */
  'software engineering': ['java','python','javascript','sql','git','api','testing','database','html','css','debugging','oop'],
  'data science': ['python','pandas','numpy','machine learning','scikit-learn','sql','visualization','statistics','nlp','model'],
  'devops': ['linux','docker','kubernetes','ci/cd','jenkins','terraform','aws','monitoring','bash','git'],
  'cyber security': ['owasp','penetration testing','network security','linux','cryptography','siem','incident response','vulnerability','firewall'],
  'business analyst': ['requirements','stakeholder','excel','sql','dashboard','kpi','process mapping','market research'],
  'venture capital': ['valuation','due diligence','term sheet','market sizing','portfolio','deal sourcing','financial modelling'],
  'hr': ['recruitment','onboarding','engagement','performance management','hris','labour law','interviewing','payroll'],
  'space': ['orbital mechanics','satellite','remote sensing','astrophysics','mission planning','matlab','python'],
  /* The fallback bank names tools, not virtues. It used to lead with
     "communication, teamwork, problem solving" — the exact words the rubric
     bans from a resume — so the scanner's own advice was to add filler. */
  'default': ['git','api','sql','testing','documentation','project','database','deployment'],
};

/* How people actually write the role on a resume, mapped to a bank. Without
   this, "Full-Stack Developer" matched nothing and every such resume lost the
   keyword check for a reason that was ours, not theirs. */
const ROLE_ALIASES = {
  mern: ['full stack', 'full-stack', 'fullstack', 'mern', 'mongo', 'node'],
  web: ['frontend', 'front-end', 'front end', 'web developer', 'ui developer', 'react developer'],
  'data science': ['data scientist', 'data science', 'machine learning', 'ml engineer', 'ai engineer', 'analyst - data'],
  devops: ['devops', 'sre', 'cloud engineer', 'platform engineer', 'aws'],
  'cyber security': ['cyber', 'security analyst', 'infosec', 'penetration'],
  backend: ['backend', 'back-end', 'back end', 'api developer', 'server-side'],
  'software engineering': ['software engineer', 'sde', 'software developer'],
  python: ['python'],
  java: ['java'],
  flutter: ['flutter', 'mobile', 'android', 'ios'],
  'business analyst': ['business analyst', 'business development', 'product analyst'],
  'venture capital': ['venture', 'investment', 'vc analyst'],
  hr: ['hr', 'human resource', 'recruit', 'talent acquisition'],
  space: ['space', 'aerospace', 'satellite'],
};

function roleBank(target) {
  const t = String(target || '').toLowerCase();
  for (const [key, aliases] of Object.entries(ROLE_ALIASES)) {
    if (aliases.some((a) => t.includes(a))) return { key, words: ROLE_KEYWORDS[key] };
  }
  for (const key of Object.keys(ROLE_KEYWORDS)) {
    if (key !== 'default' && t.includes(key.split(' ')[0])) return { key, words: ROLE_KEYWORDS[key] };
  }
  return { key: 'general', words: ROLE_KEYWORDS.default };
}

/* ── the scanner ────────────────────────────────────────────────────────── */

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const RE_PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const RE_LINK  = /(linkedin\.com\/[\w\-/]+|github\.com\/[\w\-/]+)/i;
/*
 * A date range, in the shapes people actually write.
 *
 * The closing half used to demand a bare year or "Present", so "Jun 2024 –
 * Dec 2024" did not parse — the exact format this project's own guidance
 * tells students to use ("Mon YYYY – Mon YYYY"). Four of the six commonest
 * formats failed, which quietly docked the date check on well-written
 * resumes and made a correct page look unparseable. The closing month is
 * optional now, and "to" is accepted as a separator.
 */
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const RE_DATE_RANGE = new RegExp(
  `((19|20)\\d{2}|${MONTH})[^\\n]{0,24}(-|–|—|\\bto\\b)\\s*(${MONTH}\\.?\\s*)?((19|20)\\d{2}|present|current|now)`, 'i');

function lines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim());
}

/*
 * Real bullets when the resume marks them, prose lines only as a fallback.
 * Counting every long sentence as a bullet punished summaries and contact
 * lines for not starting with a verb, which no ATS does.
 */
function bulletLines(all) {
  const marked = all.filter((l) => BULLET_RE.test(l));
  /*
   * One marked bullet is still a bullet list.
   *
   * The threshold was two, so a resume with a single "- Built ..." line fell
   * through to the prose fallback below and was scored on its summary
   * sentence, its role header and its skills line — none of which open with
   * a verb, and none of which are achievements. The report read "0/4 bullets
   * (0%)" to somebody whose only bullet began with "Built".
   */
  if (marked.length) return marked;
  /* No markers anywhere: fall back to prose lines that read like claims,
     excluding headings and the contact block, which are neither. */
  return all.filter((l) => l.length > 25 && /^[A-Z]/.test(l) && !isHeading(l) &&
    !RE_EMAIL.test(l) && !RE_LINK.test(l));
}

/* Which section a line sits under, so a check can ask about the right ones. */
function sectionOf(all, index) {
  for (let i = index; i >= 0; i--) {
    const clean = all[i].toLowerCase().replace(/[^a-z& ]/g, '').trim();
    for (const [key, names] of Object.entries(SECTION_ALIASES)) {
      if (names.includes(clean)) return key;
    }
  }
  return null;
}

/*
 * Bullets that are claims about work — the only ones an action verb belongs to.
 *
 * "B.Tech, Computer Science — 2022-2026" and "TEN Virtual Internship
 * certificate" are list entries, not achievements; nobody writes "Delivered
 * B.Tech". Scoring them for verbs docked points from every resume with an
 * education section, including well-written ones. Experience and projects are
 * where the claim lives, so that is where the check applies. When a resume has
 * no headings a parser recognises, every bullet is considered rather than
 * none — an unstructured resume should not score well by having nothing to
 * measure.
 */
function achievementBullets(all) {
  const marked = all
    .map((l, i) => ({ line: l, section: sectionOf(all, i) }))
    .filter((b) => BULLET_RE.test(b.line));

  if (!marked.length) return bulletLines(all);

  const claims = marked.filter((b) => b.section === 'experience' || b.section === 'projects');
  return (claims.length ? claims : marked).map((b) => b.line);
}

function isHeading(line) {
  const l = line.toLowerCase().replace(/[^a-z& ]/g, '').trim();
  if (!l || l.length > 34) return false;
  return Object.values(SECTION_ALIASES).some((names) => names.includes(l));
}

function foundSections(all) {
  const found = {};
  for (const [key, names] of Object.entries(SECTION_ALIASES)) {
    found[key] = all.some((l) => {
      const clean = l.toLowerCase().replace(/[^a-z& ]/g, '').trim();
      return names.includes(clean);
    });
  }
  return found;
}

/*
 * Layout hazards. A two-column CV reads beautifully to a human and arrives at
 * the parser as interleaved nonsense, so the check looks for the shape of one
 * rather than for an image it cannot see.
 */
function parseHazards(text, all) {
  const hazards = [];
  const wide = all.filter((l) => /\S\s{6,}\S/.test(l)).length; /* column gutters */
  if (wide >= 6) hazards.push('Multi-column layout detected — ATS parsers interleave columns into unreadable text. Use a single column.');
  if (/\t{2,}/.test(text)) hazards.push('Tab-built table structure detected — tables are dropped or scrambled by most parsers.');
  const odd = (text.match(/[^\x00-\x7F–—’“”•éè]/g) || []).length;
  if (odd > 25) hazards.push('Heavy use of decorative/non-standard characters — many parsers strip or garble them.');
  if (/[■□▲►◆✦❖]/.test(text)) hazards.push('Decorative glyph bullets found — use plain "-" or "•" so bullets survive parsing.');
  if (all.filter((l) => l === '').length > all.length * 0.55) hazards.push('Sparse text with large empty regions — often a sign of a graphic/text-box layout the parser cannot read.');
  return hazards;
}

function scanResume(text, target, options) {
  const jdSupplied = Boolean(options && options.jd);
  const raw = String(text || '');
  const all = lines(raw);
  const words = raw.split(/\s+/).filter(Boolean);
  const lower = raw.toLowerCase();
  /* Claims about work only — an education line is not an achievement. */
  const bullets = achievementBullets(all);
  const sections = foundSections(all);
  /*
   * A resume headed "Backend Developer" states its own target. Scoring it
   * against the generic bank because no target was passed in measured it for
   * a role nobody mentioned, and then advised adding words from that role.
   */
  const bank = roleBank(target || (atsEngine.factLedger(raw).title || ''));

  const checks = [];
  const add = (id, label, weight, earned, detail, fix) =>
    checks.push({ id, label, weight, earned: Math.round(earned), detail, fix: earned >= weight ? null : fix });

  /* 1. contact — the single most common cause of a silent rejection */
  const hasEmail = RE_EMAIL.test(raw);
  const hasPhone = RE_PHONE.test(raw);
  const hasLink = RE_LINK.test(raw);
  /* The advice names what is actually absent. A resume with an email and a
     phone number was told to "put a plain-text email and phone number at the
     top of page one" — advice for a defect it did not have, printed because
     it was short a LinkedIn URL. */
  add('contact', 'Contact details parseable', 12,
    (hasEmail ? 6 : 0) + (hasPhone ? 4 : 0) + (hasLink ? 2 : 0),
    `${hasEmail ? 'email ✓' : 'email ✗'} · ${hasPhone ? 'phone ✓' : 'phone ✗'} · ${hasLink ? 'LinkedIn/GitHub ✓' : 'LinkedIn/GitHub ✗'}`,
    !hasEmail || !hasPhone
      ? `Add your ${[!hasEmail && 'email address', !hasPhone && 'phone number'].filter(Boolean).join(' and ')} as plain text at the top of page one, in the body — never inside a header, footer or image.`
      : 'Add your LinkedIn or GitHub URL as plain text — it is the two points left on this check, and recruiters click it.');

  /* 2. required sections */
  const core = ['experience', 'education', 'skills'];
  const coreFound = core.filter((k) => sections[k]).length;
  add('sections', 'Core sections present', 16,
    (coreFound / core.length) * 13 + (sections.projects ? 2 : 0) + (sections.summary ? 1 : 0),
    `${coreFound}/3 core (${core.filter((k) => sections[k]).join(', ') || 'none'})${sections.projects ? ' + projects' : ''}`,
    /* "Add the missing section(s): —." was printed to resumes that had all
       three core sections and were merely short the projects bonus. */
    coreFound < core.length
      ? `Add the missing section(s): ${core.filter((k) => !sections[k]).join(', ')}.`
      : `All three core sections are here. The points left are the bonus ones: ${[!sections.projects && 'a Projects section', !sections.summary && 'a short Summary'].filter(Boolean).join(' and ')}.`);

  /* 3. standard heading wording */
  const headingCount = all.filter(isHeading).length;
  add('headings', 'Standard section headings', 8,
    headingCount >= 3 ? 8 : headingCount * 2.5,
    `${headingCount} recognised heading${headingCount === 1 ? '' : 's'}`,
    'Rename creative headings to the words parsers index: Experience, Education, Skills, Projects.');

  /* 4. action verbs */
  const verbStart = bullets.filter((b) => {
    const first = b.replace(BULLET_RE, '').split(/\s+/)[0] || '';
    return ACTION_VERBS.includes(first.toLowerCase().replace(/[^a-z]/g, ''));
  }).length;
  const verbRatio = bullets.length ? verbStart / bullets.length : 0;
  add('verbs', 'Bullets open with action verbs', 12, Math.min(12, verbRatio * 14),
    `${verbStart}/${bullets.length || 0} bullets (${Math.round(verbRatio * 100)}%)`,
    'Start each bullet with a verb — Built, Led, Reduced, Automated — not "Responsible for" or "Worked on".');

  /* 5. quantified achievement — a number, or the scope the ats-resume skill
     accepts in its place: users named, team size, frequency. "Ran tests
     before each weekly submission" is a scoped claim; inventing "cut rework
     25%" to replace it is what this engine exists to refuse. */
  const quantified = bullets.filter((b) =>
    /\d+\s*(%|percent|k\b|x\b|\+)|\b\d{2,}\b|₹|\$|€/.test(b) ||
    /\b(daily|weekly|monthly|biweekly)\b/i.test(b) ||
    /\b(users?|students?|clients?|team of)\b/i.test(b)).length;
  const quantRatio = bullets.length ? quantified / bullets.length : 0;
  add('quantified', 'Achievements are quantified', 12, Math.min(12, quantRatio * 24),
    `${quantified}/${bullets.length || 0} bullets carry a number or stated scope (${Math.round(quantRatio * 100)}%)`,
    'Add measurable outcomes to at least half your bullets: "cut load time 40%", "handled 1,200 users", "raised ₹2L".');

  /* 6. skills block, matched against the target role */
  const matched = bank.words.filter((w) => lower.includes(w));
  /*
   * Without a job description the bank is a proxy, not a requirement.
   *
   * It demanded roughly 60% of a twelve-word list, so a backend engineer
   * naming Java, Spring Boot, REST API, PostgreSQL, Git, Docker, SQL and
   * Testing was marked down for having no HTML, CSS or Python — languages the
   * role they named does not use. Nobody can reach full marks against a list
   * of every language in the family, and being told to add them is advice to
   * put things on a resume that are not true. With a real posting the bar
   * stays where it was, because then the list is the employer's, not ours.
   */
  const bar = jdSupplied ? bank.words.length * 0.6 : bank.words.length * 0.4;
  add('skills', 'Skills match the target role', 10,
    Math.min(10, (matched.length / Math.max(4, bar)) * 10),
    `${matched.length}/${bank.words.length} ${bank.key} keywords present`,
    `Work these into Skills and your bullets where true: ${bank.words.filter((w) => !lower.includes(w)).slice(0, 6).join(', ')}.`);

  /* 7. length */
  const wc = words.length;
  /*
   * A ramp, not a cliff. The bands stepped 2 → 5 → 8 at 180 and 250 words, so
   * a 235-word resume lost three points to a 255-word one for a difference no
   * reader would notice, and a focused one-page intern resume was scored as
   * though it were a stub. Thinness is a matter of degree, so the points are
   * too: full marks from 250 words, sliding down to the floor at 120.
   */
  const lengthScore = wc >= 250 && wc <= 900 ? 8
    : wc > 900 ? (wc <= 1200 ? 5 : 2)
      : wc <= 120 ? 2
        : 2 + ((wc - 120) / (250 - 120)) * 6;
  /* The label names the fault, not the check. Under the heading "what is
     costing you shortlists", a row reading "Length is in range — Too long"
     tells the reader the opposite of itself in four words. */
  add('length', wc < 250 ? 'Length — too thin' : wc > 900 ? 'Length — too long' : 'Length is in range',
    8, lengthScore, `${wc} words`,
    wc < 250 ? 'Thin for a full page — an ATS has less to match. Expand bullets with the tools used and the outcome.'
             : 'Over one page — cut the weakest bullets, the ones with no number and no outcome.');

  /* 8. parse hazards */
  const hazards = parseHazards(raw, all);
  add('layout', 'Layout is machine-readable', 12, Math.max(0, 12 - hazards.length * 4),
    hazards.length ? `${hazards.length} hazard${hazards.length === 1 ? '' : 's'}` : 'single column, clean text',
    hazards[0] || 'Keep a single-column layout with no tables, text boxes or graphics.');

  /* 9. dates */
  const dateHits = (raw.match(new RegExp(RE_DATE_RANGE.source, 'gi')) || []).length;
  add('dates', 'Date ranges are parseable', 10,
    dateHits >= 2 ? 10 : dateHits * 4.5,
    `${dateHits} parseable range${dateHits === 1 ? '' : 's'}`,
    'Write dates as "Jan 2025 – Jun 2025" or "2024 – Present" next to each role, in the body text.');

  const score = Math.max(0, Math.min(100, Math.round(checks.reduce((s, c) => s + c.earned, 0))));
  const verdict = score >= 80 ? 'ats_ready' : score >= 60 ? 'borderline' : 'will_be_rejected';

  return {
    score,
    verdict,
    verdictText:
      verdict === 'ats_ready'   ? 'ATS-ready — this parses cleanly and matches the role.'
    : verdict === 'borderline'  ? 'Borderline — it parses, but weak spots will cost you shortlists.'
                                : 'Not ATS-friendly — this is the kind of resume that gets filtered out before a human sees it.',
    target: bank.key,
    stats: { words: wc, bullets: bullets.length, sections: Object.keys(sections).filter((k) => sections[k]) },
    checks,
    /*
     * "What is costing you shortlists" means points actually lost, not every
     * check that happens to carry advice. This filtered on the presence of a
     * fix string, so a resume scoring 14/16 on sections — all three core
     * sections present, short only the projects bonus — appeared on the list
     * of what was getting it rejected. A check has to lose at least a fifth
     * of its weight, and at least one whole point, to be named there.
     */
    failing: checks
      .filter((c) => c.fix && c.weight - c.earned >= Math.max(1, c.weight * 0.2))
      .map((c) => ({ label: c.label, fix: c.fix, lost: c.weight - c.earned }))
      .sort((a, b) => b.lost - a.lost),
    hazards,
    missingKeywords: bank.words.filter((w) => !lower.includes(w)),
  };
}

/* ── the builder ────────────────────────────────────────────────────────── */

/*
 * Details arrive either as a filled object or as one blob of text a student
 * typed into the chat. Free text is parsed with labelled lines ("skills: ...")
 * because asking for a rigid form in a chat box is how people give up.
 */
function parseDetails(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  const d = {};
  for (const line of lines(input)) {
    const m = line.match(/^([a-z ]{3,20}):\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase().trim().replace(/\s+/g, '');
    const val = m[2].trim();
    if (key.startsWith('name')) d.name = val;
    else if (key.startsWith('role') || key.startsWith('title') || key.startsWith('target')) d.role = val;
    else if (key.startsWith('email')) d.email = val;
    else if (key.startsWith('phone') || key.startsWith('mobile')) d.phone = val;
    else if (key.startsWith('link')) d.linkedin = val;
    else if (key.startsWith('git')) d.github = val;
    else if (key.startsWith('skill')) d.skills = val;
    else if (key.startsWith('edu')) d.education = val;
    else if (key.startsWith('exp') || key.startsWith('work')) d.experience = val;
    else if (key.startsWith('project')) d.projects = val;
    else if (key.startsWith('city') || key.startsWith('location')) d.location = val;
  }
  return d;
}

/*
 * Items a student typed. Their own bullet characters are stripped: pasting
 * "• B.Tech CSE" and having the builder prepend its own dash produced
 * "- • B.Tech CSE" on the shipped page — two bullets, one line, and a parser
 * reading a stray glyph as content.
 */
const splitItems = (v) => String(v || '')
  .split(/[;|]|\s*\n\s*/)
  .map((s) => s.trim().replace(/^[-*•▪◦‣·]+\s*/, '').trim())
  .filter(Boolean);

/*
 * The same split for fields where a pipe separates columns, not items.
 *
 * "Web Developer Intern | Zeta Labs | Jun 2024 – Dec 2024" is one role
 * written the way every resume writes one. Splitting it on the pipe turned a
 * header into three fragments, which then came back verb-fronted as "Built
 * web Developer Intern", "Delivered zeta Labs" and "Implemented jun 2024 -
 * Dec 2024" — three achievements nobody claimed, and the dates lost.
 */
const splitLines = (v) => String(v || '')
  .split(/;|\s*\n\s*/)
  .map((s) => s.trim().replace(/^[-*•▪◦‣·]+\s*/, '').trim())
  .filter(Boolean);

/*
 * A line naming where and when somebody worked, rather than what they did.
 *
 * "Backend Engineer | Zeta Systems | Jan 2023 – Present" and "Web Developer
 * Intern, Zeta Labs, Jun 2024 – Dec 2024" are headers: they carry the dates
 * the parser reads, and they are the one kind of experience line that must
 * not be verb-fronted into a bullet.
 */
function looksLikeRoleHeader(line) {
  const t = String(line || '').trim();
  if (!t || t.length > 120) return false;
  if (/^[-*•]/.test(t)) return false;             /* they marked it a bullet themselves */
  if (!RE_DATE_RANGE.test(t) && !/\|/.test(t)) return false;
  /* A bullet can mention a date too, so require a title word and no verb. */
  const first = t.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (ACTION_VERBS.includes(first)) return false;
  return RE_JOB_TITLE_LINE.test(t) || /\|/.test(t);
}
const RE_JOB_TITLE_LINE = /\b(engineer|developer|analyst|scientist|designer|architect|manager|consultant|specialist|associate|assistant|coordinator|executive|officer|lead|intern|trainee|freelancer|administrator|technician|researcher)\b/i;

/* Bullets are rewritten to open with an action verb, because that is a
   scored check — the builder must not ship what the scanner would fail. */
function toBullet(text, i) {
  let t = String(text || '').trim().replace(/^([-*•]\s*)/, '');
  if (!t) return null;
  const first = t.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!ACTION_VERBS.includes(first)) {
    t = t.replace(/^(responsible for|worked on|helped with|involved in)\s*/i, '');
    const verb = ['Built', 'Delivered', 'Implemented', 'Led', 'Automated', 'Improved'][i % 6];
    /* Lowercasing the joint turned "JWT authentication service" into "jWT"
       and "Zeta Labs" into "zeta Labs". A word that is not plain capitalised
       prose — an acronym, a product, a name — keeps its own spelling. */
    const head = t.split(/\s+/)[0];
    const isProper = /^[A-Z]{2,}$/.test(head) || /[A-Z]/.test(head.slice(1));
    t = verb + ' ' + (isProper ? t : t.charAt(0).toLowerCase() + t.slice(1));
  } else {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t.replace(/\.$/, '');
}

function buildResume(detailsInput) {
  const d = parseDetails(detailsInput);
  const bank = roleBank(d.role);
  const name = d.name || 'Your Name';
  /* A title typed as "Backend Engineer," carries its punctuation onto the
     page and into the cover letter — "applying for the Backend Engineer,
     role". It is a title, not a sentence. */
  const role = String(d.role || 'Software Developer').replace(/[\s,;:.\-–]+$/, '').trim() || 'Software Developer';

  const contactBits = [d.email, d.phone, d.linkedin, d.github, d.location].filter(Boolean);
  /*
   * The student's skills, or none.
   *
   * This used to fall back to the role bank's generic words, so a resume
   * built without answers shipped "communication, teamwork, problem solving,
   * project, git" as though the person had claimed them — skills nobody
   * stated, on a page they could download and send. A resume is a set of
   * claims; the agent does not get to make them.
   */
  const skills = splitItems(d.skills);

  const expItems = splitLines(d.experience);
  const projItems = splitLines(d.projects);
  const eduItems = splitLines(d.education);

  const L = [];
  L.push(name.toUpperCase());
  L.push(role);
  /*
   * With no contact details, this used to emit "email@example.com | +91 00000
   * 00000" — a fabricated address that satisfied the contact check and lifted
   * the score for a resume nobody could reply to. A student who did not read
   * carefully could send it. The placeholder is now unmistakably a blank to
   * fill, it deliberately does not parse as an address, and the contact check
   * is allowed to fail honestly so `missing` can report what it costs.
   */
  L.push(contactBits.join(' | ') || '[ add your email and phone here — an ATS discards an application it cannot contact ]');
  /*
   * From here down, every line is the student's, or it does not exist.
   *
   * This block used to be a template with a name poured into it. A person who
   * gave only a name and a job title got back a page carrying a four-sentence
   * character reference they never wrote ("reads existing code before changing
   * it, keeps commits small enough to review"), a TEN Virtual Internship dated
   * Jan 2026 – Present whether or not they had done one, three invented
   * bullets, a capstone project, a documentation bullet promising setup "in
   * under 10 minutes", a B.Tech in Computer Science dated 2022 – 2026, and a
   * completion certificate — and the same function reported "education" as
   * missing while the page it had just written showed a degree.
   *
   * An earlier pass took out the invented metrics and left the invented
   * biography, which is the more dangerous half: a fabricated number ends an
   * interview, a fabricated degree ends a career. A section with no facts
   * behind it is now absent from the page and named in `missing` instead.
   */
  const section = (heading, lines) => {
    const kept = lines.filter(Boolean);
    if (!kept.length) return;
    L.push('');
    L.push(heading);
    kept.forEach((l) => L.push(l));
  };

  /* The summary states the role and the tools they claimed — nothing else.
     With no skills it stays one clause, rather than trailing "across ." */
  L.push('');
  L.push('SUMMARY');
  /*
   * Their strongest quantified line, repeated at the top.
   *
   * A summary of one clause — "Software Engineer with hands-on experience
   * across Java, Spring Boot" — is the shortest section on the page and the
   * first one read. The convert path has always led with the person's best
   * scoped achievement; the builder did not, which cost the page both its
   * opening and forty words of length it had honestly earned. Nothing new is
   * claimed: this is a sentence they already wrote, in the place a recruiter
   * looks first.
   */
  const spike = [...expItems, ...projItems]
    .map((t) => String(t).trim())
    .filter((t) => /\d/.test(t) && !looksLikeRoleHeader(t) && t.split(/\s+/).length > 6)[0];
  L.push([
    skills.length
      ? `${role} with hands-on experience across ${skills.slice(0, 6).join(', ')}.`
      : `${role}.`,
    spike ? `${toBullet(spike, 0)}.` : '',
    d.availablefrom || d.hours
      ? `${[d.availablefrom, d.hours && `able to commit ${d.hours}`].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}.`
      : '',
  ].filter(Boolean).join(' '));

  section('SKILLS', [skills.join(', ')]);
  /*
   * A role header is a header, not an achievement.
   *
   * Every experience line was verb-fronted, so "Backend Engineer — TEN
   * Virtual Internship | Jan 2026 – Present" shipped as "- Built backend
   * Engineer, - TEN Virtual Internship" and the dates beneath it as
   * "- Delivered jan 2026 - Present". The header also carries the dates the
   * parser looks for, and turning it into prose is what lost them.
   */
  section('EXPERIENCE', expItems.map((e, i) => {
    if (looksLikeRoleHeader(e)) return String(e).trim();
    const b = toBullet(e, i);
    return b ? `- ${b}` : null;
  }));
  /*
   * A project line names the project first.
   *
   * Verb-fronting is right for an achievement and wrong for a title: "globby
   * — user-friendly glob matching" came back as "Led globby", and the next
   * one as "Automated awesome", because the rotating verb was applied to the
   * project's own name. A line already shaped "Name — what it does" is left
   * exactly as written.
   */
  section('PROJECTS', projItems.map((p, i) => {
    const named = /^[^—–-]{2,40}\s[—–-]\s\S/.test(String(p).trim());
    const b = named ? String(p).trim() : toBullet(p, i + 2);
    return b ? `- ${b}` : null;
  }));
  section('EDUCATION', eduItems.map((e) => `- ${e}`));
  section('CERTIFICATIONS', splitItems(d.certifications).map((c) => `- ${c}`));

  const text = L.join('\n');
  const report = scanResume(text, role);

  /*
   * What the student still has to supply, and what each one is worth.
   *
   * The pattern is borrowed from PC-Automation's `doctor` verb: rather than
   * failing quietly, report the capability that is missing, why it matters and
   * how to supply it. A resume built without an email address genuinely cannot
   * score 100 — an ATS drops an applicant it cannot contact — so the honest
   * answer is to name the gap and its cost, never to invent a plausible
   * address to make the number look better.
   */
  const missing = [];
  if (!d.email)    missing.push({ field: 'email',      worth: 6, why: 'An ATS that cannot extract an email address usually discards the application outright.' });
  if (!d.phone)    missing.push({ field: 'phone',      worth: 4, why: 'Recruiters filter on a reachable number; parsers look for one near the top.' });
  if (!d.linkedin && !d.github) missing.push({ field: 'linkedin or github', worth: 2, why: 'A profile link is the cheapest credibility on the page.' });
  if (!splitItems(d.skills).length)     missing.push({ field: 'skills',     worth: 10, why: 'Keyword matching against the job description is most of the ATS score.' });
  if (!expItems.length)                 missing.push({ field: 'experience', worth: 8,  why: 'Your own wording beats the generic internship bullets used as a fallback.' });
  if (!eduItems.length)                 missing.push({ field: 'education',  worth: 4,  why: 'Degree and years are a standard filter field.' });
  if (!projItems.length)                missing.push({ field: 'projects',   worth: 4,  why: 'Projects are where a student without job history proves the skills.' });
  /* Numbers are asked for, never added. The old builder appended fake
     percentages here; now the gap is named and left for the student. */
  if ([...expItems, ...projItems].length && ![...expItems, ...projItems].some((x) => /\d/.test(x))) {
    missing.push({ field: 'a real metric', worth: 6, why: 'None of your bullets carries a number. Add one true figure — users, records, time saved — per strong bullet. Invented metrics fail interviews, so none were added for you.' });
  }

  return {
    text,
    report,
    details: d,
    missing,
    /* Honest headroom: what the score becomes once these are supplied. */
    potentialScore: Math.min(100, report.score + missing.reduce((s, m) => s + m.worth, 0)),
  };
}

/* ── the PDF ────────────────────────────────────────────────────────────── */

/*
 * Renders the built resume as a PDF whose text an ATS can actually extract.
 *
 * The temptation with a resume PDF is to make it beautiful: two columns, a
 * sidebar, icons, a header band. Every one of those is why resumes get
 * silently dropped — a parser reads a two-column layout as interleaved
 * nonsense and an icon as nothing at all. So this is deliberately plain:
 * one column, real text (never an image), standard fonts, the same headings
 * the scanner looks for, and no tables. It is scored after rendering, from
 * the text extracted back out of the finished file, so the number on the
 * screen belongs to the document the student actually sends.
 */
function renderResumePdf(text, opts = {}) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    /* Compression off makes the text greppable in the raw bytes, which is how
       the tests prove the page is real text rather than a picture of one
       without depending on a PDF parser. Students get the compressed file. */
    compress: opts.compress !== false,
  });

  const lines = String(text || '').split(/\r?\n/);
  const HEADINGS = new Set(['SUMMARY', 'SKILLS', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS']);

  lines.forEach((line, i) => {
    const t = line.trim();

    if (!t) { doc.moveDown(0.45); return; }

    /* The name: the first line, and the only thing set large. */
    if (i === 0) {
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(t, { align: 'left' });
      return;
    }
    /* Role and contact line sit under it, still plain text so they parse. */
    if (i === 1) {
      doc.font('Helvetica').fontSize(11.5).fillColor('#333333').text(t);
      return;
    }
    if (i === 2) {
      doc.font('Helvetica').fontSize(9.5).fillColor('#555555').text(t);
      doc.moveDown(0.3);
      return;
    }

    if (HEADINGS.has(t)) {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(t);
      /* A rule is drawn, not typed — a row of dashes would land in the
         extracted text and read as noise to the parser. */
      const y = doc.y + 2;
      doc.moveTo(54, y).lineTo(doc.page.width - 54, y).lineWidth(0.6).strokeColor('#999999').stroke();
      doc.moveDown(0.45);
      return;
    }

    if (/^-\s+/.test(t)) {
      doc.font('Helvetica').fontSize(9.8).fillColor('#222222')
         .text('• ' + t.replace(/^-\s+/, ''), { indent: 8, lineGap: 1.4 });
      return;
    }

    doc.font('Helvetica').fontSize(9.8).fillColor('#222222').text(t, { lineGap: 1.4 });
  });

  if (opts.footer !== false) {
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(7.5).fillColor('#888888')
       .text('Built with the TEN Resume Portal — entrepreneurshipnetwork.net', { align: 'center' });
  }

  return doc;
}

/** The finished PDF as a Buffer, so it can be scored before it is sent. */
function resumePdfBuffer(text, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = renderResumePdf(text, opts);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/* ── routes ─────────────────────────────────────────────────────────────── */

/*
 * Placeholders that mean the page is not finished.
 *
 * A recording showed a downloaded PDF headed "YOUR NAME", carrying "[ add
 * your email and phone here ]" and a skills line of words the student never
 * claimed. That file is a template wearing a resume's clothes, and letting it
 * export is worse than refusing: somebody sends it.
 */
const PLACEHOLDER_MARKS = [
  /^\s*YOUR NAME\s*$/mi,
  /\[\s*add your email and phone/i,
  /\[\s*list the tools your bullets actually show/i,
];

/** What is still missing, phrased so a person knows what to type next. */
function missingEssentials(text) {
  const gaps = [];
  const t = String(text || '');
  if (/^\s*YOUR NAME\s*$/mi.test(t)) gaps.push('your name');
  if (/\[\s*add your email and phone/i.test(t)) gaps.push('an email address and phone number');
  if (/\[\s*list the tools/i.test(t)) gaps.push('the tools you have actually used');
  const skillsLine = (t.split(/\r?\n/)[t.split(/\r?\n/).findIndex((l) => l.trim() === 'SKILLS') + 1] || '').trim();
  if (!skillsLine || /^\[/.test(skillsLine)) {
    if (!gaps.includes('the tools you have actually used')) gaps.push('the tools you have actually used');
  }
  return gaps;
}

const hasPlaceholders = (text) => PLACEHOLDER_MARKS.some((re) => re.test(String(text || '')));

async function textFromUpload(file) {
  if (!file) return '';
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse');
    const out = await pdfParse(file.buffer);
    return out.text || '';
  }
  return file.buffer.toString('utf8');
}

/* multer only fills req.body for multipart requests; a JSON or form post that
   never reaches a body parser leaves it undefined, and reading .message off it
   crashed the route. Every handler treats a missing body as an empty one. */
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

router.post('/scan', upload.single('file'), async (req, res) => {
  try {
    const b = bodyOf(req);
    const text = (await textFromUpload(req.file)) || b.text || '';
    if (!text.trim()) {
      return res.status(400).json({ ok: false, error: 'Send a resume: attach a PDF/TXT file or paste the text.' });
    }
    const report = scanResume(text, b.target || b.role);
    /*
     * A failing resume is not left as a verdict — the rebuild is the point.
     *
     * This used to hand back the generic TEN scaffold with the student's name
     * on it, which threw away their actual experience, projects and skills.
     * The engine's CONVERT mode rebuilds from their own fact ledger instead:
     * same facts, safe skeleton, nothing invented.
     */
    let rebuilt = null;
    if (report.verdict !== 'ats_ready') {
      const packet = atsEngine.rewriteResume(text, { target: b.target || b.role, jd: b.jd, mode: 'CONVERT' });
      rebuilt = {
        text: packet.resume,
        report: scanResume(packet.resume, b.target || b.role),
        packet,
      };
    }
    res.json({ ok: true, report, rebuilt });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not read that file. Try a text-based PDF (not a scan) or paste the text.' });
  }
});

router.post('/build', (req, res) => {
  const b = bodyOf(req);
  const built = buildResume(b.details || b.text || b);
  res.json({ ok: true, ...built });
});

/*
 * RECREATE / CONVERT — the ats-resume skill's full pipeline over an existing
 * resume: fact ledger, rejection diagnosis, dual score before, rebuild from
 * the person's own facts on the safe skeleton, dual score after, ship gate,
 * Not-claimed list, honest ceiling. Pass `jd` for keyword scoring; without it
 * the checker is honestly out of 60.
 */
router.post('/rewrite', upload.single('file'), async (req, res) => {
  try {
    const b = bodyOf(req);
    const text = (await textFromUpload(req.file)) || b.text || '';
    if (!text.trim()) {
      return res.status(400).json({ ok: false, error: 'Send a resume: attach a PDF/TXT file or paste the text.' });
    }
    const packet = atsEngine.rewriteResume(text, {
      target: b.target || b.role,
      jd: b.jd || b.jobDescription,
      mode: b.mode === 'RECREATE' ? 'RECREATE' : 'CONVERT',
    });
    res.json({ ok: true, ...packet });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not read that file. Try a text-based PDF (not a scan) or paste the text.' });
  }
});

/*
 * The same resume as a downloadable PDF.
 *
 * The score returned in the header is measured from the text pulled back out
 * of the rendered file, not from the string we started with — if the renderer
 * ever produced something a parser could not read, that number would collapse
 * and we would know. A resume PDF that scores well only in theory is the exact
 * failure this portal exists to prevent.
 */
/*
 * `upload.any()` because the details arrive as multipart from the browser's
 * FormData. Without a multipart parser this route saw an empty body, built a
 * page of placeholders from nothing, and — once the placeholder guard existed
 * — rejected every download including the complete ones.
 */
router.post('/build.pdf', upload.any(), async (req, res) => {
  try {
    const b = bodyOf(req);
    const built = buildResume(b.details || b.text || b);

    /* A page still carrying placeholders is not a resume, and a downloaded
       file is the one artefact nobody reviews again before sending it. */
    if (hasPlaceholders(built.text)) {
      return res.status(400).json({
        ok: false,
        error: `This is not finished yet — it still needs ${missingEssentials(built.text).join(', ')}. Give me those and the download will carry your details instead of placeholders.`,
        missing: missingEssentials(built.text),
      });
    }

    const buf = await resumePdfBuffer(built.text);

    let pdfScore = null;
    try {
      const pdfParse = require('pdf-parse');
      const extracted = (await pdfParse(buf)).text || '';
      pdfScore = scanResume(extracted, built.details.role).score;
    } catch (_) { /* scoring the artefact is a check, not a gate */ }

    const safeName = String(built.details.name || 'resume').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'resume'}-TEN.pdf"`);
    res.setHeader('X-ATS-Score', String(built.report.score));
    if (pdfScore !== null) res.setHeader('X-ATS-Score-From-PDF', String(pdfScore));
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not render the PDF.' });
  }
});

/*
 * The resume as a .docx — what the ats-resume skill prefers for Workday and
 * Taleo, and what several of the referenced builders ship first. Scored from
 * the same text, since a Word file's paragraphs are the reading order.
 */
router.post('/build.docx', upload.single('file'), async (req, res) => {
  try {
    const b = bodyOf(req);
    let text = (await textFromUpload(req.file)) || b.resumeText || b.text || '';

    /* A details payload builds first; raw resume text is converted. */
    if (!text.trim() && (b.details || b.name || b.skills)) {
      text = buildResume(b.details || b).text;
    } else if (text.trim() && b.convert !== '0') {
      text = atsEngine.rewriteResume(text, { target: b.target || b.role, jd: b.jd }).resume;
    }
    if (!text.trim()) {
      return res.status(400).json({ ok: false, error: 'Send a resume: attach a file, paste the text, or give your details.' });
    }

    if (hasPlaceholders(text)) {
      return res.status(400).json({
        ok: false,
        error: `This is not finished yet — it still needs ${missingEssentials(text).join(', ')}.`,
        missing: missingEssentials(text),
      });
    }

    const { resumeDocxBuffer } = require('../../services/v2/resumeDocx');
    const buf = await resumeDocxBuffer(text);
    const report = scanResume(text, b.target || b.role);
    const name = (text.split('\n')[0] || 'resume').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${name || 'resume'}-TEN.docx"`);
    res.setHeader('X-ATS-Score', String(report.score));
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not render the DOCX.' });
  }
});

/*
 * The rewritten resume as a text-selectable, single-column PDF — ship gate
 * check 12's artefact. Scored from the text extracted back out of the
 * rendered file, the same proof the build.pdf route gives.
 */
router.post('/rewrite.pdf', upload.single('file'), async (req, res) => {
  try {
    const b = bodyOf(req);
    const text = (await textFromUpload(req.file)) || b.text || '';
    if (!text.trim()) {
      return res.status(400).json({ ok: false, error: 'Send a resume: attach a PDF/TXT file or paste the text.' });
    }
    const packet = atsEngine.rewriteResume(text, { target: b.target || b.role, jd: b.jd });
    const buf = await resumePdfBuffer(packet.resume);

    let pdfScore = null;
    try {
      const pdfParse = require('pdf-parse');
      const extracted = (await pdfParse(buf)).text || '';
      pdfScore = scanResume(extracted, b.target || b.role).score;
    } catch (_) { /* scoring the artefact is a check, not a gate */ }

    const safeName = String((packet.ledger && packet.ledger.name) || 'resume').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'resume'}-TEN-rewrite.pdf"`);
    res.setHeader('X-ATS-Checker-After', String(packet.after.checker));
    res.setHeader('X-Recruiter-Scan-After', String(packet.after.recruiter));
    if (pdfScore !== null) res.setHeader('X-ATS-Score-From-PDF', String(pdfScore));
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not render the PDF.' });
  }
});

/* ── the conversation (v5.1: commands + one-question-at-a-time interview) ── */

/*
 * The chat was a stateless keyword router, and that is exactly why it kept
 * repeating itself: it could ask an interview question, but the student's
 * ANSWER matched no keyword, fell through every branch, and landed on the
 * same help text — every turn, forever. An agent that asks questions has to
 * remember having asked them.
 *
 * So each turn now carries a session — command, collected answers, resume
 * text, which question is pending — that the client echoes back. An answer
 * is consumed by the question that asked for it, the next question follows,
 * and when the skill's stop rule says build, it builds. The commands are
 * v5.1's: check, build, tailor, gap.
 */

/**
 * "Fix it", "resolve them", "yes, improve it" — every way a person says
 * "make the resume better" after seeing its score. This was the reported
 * loop: "fix it" matched no command, fell to the help menu, and the visitor
 * asked again and got the menu again, forever.
 */
const FIX_INTENT = /\b(fix|resolve|improve|repair|rebuild|solve|correct)( it| this| them| that| these| my resume| the (issues?|problems?|resume))?\b|\bmake it better\b|\bdo it\b|\bgo ahead\b/;

/*
 * "Make it 98/100", "do all", "unrejectable" — the score-chasing phrasings
 * the skill's own description names as triggers. They fell through to the
 * help menu, twice in a row for one user, which is the repeat bug wearing a
 * new coat: an unmatched message must advance the conversation, never
 * reprint the menu.
 */
const SCORE_INTENT = /make it \d+|\b\d{2}\s*\/\s*100\b|\bunrejectable\b|max(imi[sz]e)?( the)? score|\b(raise|boost|increase) (the |my )?score\b|\bfull marks\b|\bbest score\b/;

/**
 * The honest levers, run to exhaustion before any number is quoted.
 *
 * The rule this exists to keep: when someone asks for 98 they are not asking
 * for 90. Every point that formatting, headings, verbs, keyword placement or
 * length can win must be won first — and only a missing FACT may stop the
 * climb. Then the ceiling is stated with the one fact that would lift it,
 * and never closed by inventing that fact.
 *
 * Returns the best text it could reach plus what is still costing points and
 * whether a real fact is the blocker.
 */
const STRONG_VERB_SET = new Set(ACTION_VERBS);

function raiseToTarget(text, target, jd, goal) {
  const want = goal || 98;
  let best = String(text || '');
  let report = scanResume(best, target);

  /* Lever 1 — the parse-safe rebuild. Single column, standard headings,
     verbs fronted, unevidenced skills dropped: all format, no new claims. */
  const packet = atsEngine.rewriteResume(best, { target, jd, mode: 'CONVERT' });
  const rebuiltReport = scanResume(packet.resume, target);
  if (rebuiltReport.score > report.score) { best = packet.resume; report = rebuiltReport; }

  /* Lever 2 — verb fronting on any bullet the rebuild left without one.
     Wording only: the fact in the bullet is untouched. */
  if (report.score < want) {
    const relined = best.split('\n').map((line, i) => {
      if (!/^-\s+/.test(line)) return line;
      const body = line.replace(/^-\s+/, '');
      const fronted = toBullet(body, i);
      return fronted ? `- ${fronted}` : line;
    }).join('\n');
    const r2 = scanResume(relined, target);
    if (r2.score > report.score) { best = relined; report = r2; }
  }

  /*
   * Lever 3 — cut an over-long page down.
   *
   * A 993-word resume is two pages of a one-page job, and the agent used to
   * report that as a fact about the student rather than something it could
   * fix: it asked them for MORE work to add. Trimming is the one length
   * problem that is entirely ours to solve, and it is done by dropping the
   * weakest lines — the ones with no number and no verb — never the strongest.
   */
  if (report.score < want) {
    const words = best.split(/\s+/).filter(Boolean).length;
    if (words > 900) {
      const lines = best.split('\n');
      /* Rank the bullets: a line with a number and a verb is the last to go. */
      const weight = (l) => {
        const b = l.replace(/^-\s+/, '');
        return (/\d/.test(b) ? 2 : 0) +
          (STRONG_VERB_SET.has((b.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '')) ? 1 : 0);
      };
      /*
       * Cut toward the band, not by a fixed fraction.
       *
       * A single 25% pass on a 1,650-word page still leaves 1,240 words, which
       * scores the same — so the trim was measured as no improvement and
       * discarded, and the page stayed twice as long as it should be. The
       * weakest bullets come off until the page is inside one sheet or there
       * is nothing weak left to lose.
       */
      /*
       * Keep the best bullets that fit, rather than dropping the worst ones.
       *
       * The first version refused to cut any line carrying both a number and
       * a verb — sound advice for a page that is slightly long, and useless
       * for one with sixty bullets, where every line qualified and nothing
       * was cut at all. A sheet of paper holds what it holds: the strongest
       * lines are kept in their original order until the budget is spent, and
       * the rest come off however good they are.
       */
      const bulletLines = lines.map((l, i) => ({ l, i })).filter((x) => /^-\s+/.test(x.l));
      const keep = new Set();
      let used = words - bulletLines.reduce((n, x) => n + x.l.split(/\s+/).filter(Boolean).length, 0);
      [...bulletLines]
        .sort((a, b) => weight(b.l) - weight(a.l) || a.i - b.i)
        .forEach((cand) => {
          const cost = cand.l.split(/\s+/).filter(Boolean).length;
          if (used + cost <= 780) { keep.add(cand.i); used += cost; }
        });
      const doomed = new Set(bulletLines.filter((x) => !keep.has(x.i)).map((x) => x.i));
      if (doomed.size) {
        const trimmed = lines.filter((_, i) => !doomed.has(i)).join('\n');
        const r3 = scanResume(trimmed, target);
        if (r3.score >= report.score) { best = trimmed; report = r3; }
      }
    }
  }

  /* What is still costing points, and whether it is a fact or a format. */
  const failing = report.checks.filter((c) => c.earned < c.weight)
    .map((c) => ({ id: c.id, lost: Math.round(c.weight - c.earned), detail: c.detail, fix: c.fix }))
    .sort((a, b) => b.lost - a.lost);

  /* Only these can be closed by the person, not by the writer. */
  const FACT_BLOCKED = { quantified: 'one real number for your strongest bullet — users, records, time saved, team size', skills: 'one more evidenced skill the target role asks for', length: 'more detail on what you actually built', contact: 'your email and phone', dates: 'the months and years for each role', sections: 'the missing section' };
  const blocker = failing.find((f) => FACT_BLOCKED[f.id]);

  return {
    text: best,
    report,
    reached: report.score >= want,
    failing,
    /* The one question that would unlock the most points. */
    needFact: !report.score || report.score >= want ? null
      : (blocker ? { id: blocker.id, ask: FACT_BLOCKED[blocker.id], lost: blocker.lost } : null),
  };
}

/* "do all" is its own command in the ten-resume-agent skill: a pipeline that
   checks first and only tailors when a JD exists — never four menus. */
const DO_ALL = /\bdo (it all|all|everything|them all)\b|\brun everything\b|\bfull pipeline\b/;

/**
 * "Make a resume of a software developer" — a request to BUILD, and for a
 * stated role.
 *
 * This lost to the score matcher: "make it 98/100" in the same sentence
 * routed the whole thing to raise, which handed the student back the DevOps
 * resume they had uploaded earlier with a ceiling note attached. They asked
 * for a new resume for a different role and received their old one.
 *
 * A score is a quality bar on the thing being made, never the thing itself,
 * so build wins whenever both appear.
 */
const BUILD_INTENT = /\b(make|build|create|write|generate|draft)\s+(me\s+)?(a|an|my)?\s*(new\s+)?(resume|cv)\b|\bfrom scratch\b/;

/**
 * The role named in the sentence: "resume of a software developer",
 * "cv for a data analyst", "resume as a devops engineer".
 */
function targetFromSentence(low) {
  const m = String(low).match(
    /\b(?:resume|cv)\s+(?:of|for|as)\s+(?:an?\s+|the\s+)?([a-z][a-z0-9+#./ -]{2,40}?)(?=\s+(?:and|with|that|which|to|so|please|role|position|job)\b|[,.]|$)/);
  if (!m) return '';
  return m[1].trim().replace(/\s+/g, ' ');
}

/**
 * A pasted resume, recognised as a document rather than read as a sentence.
 *
 * The agent invites this — "attach or paste the resume" — and then ran the
 * paste through the command map, where a career summary reading "2 years
 * building services" matched the BUILD verb and the reply was "what job title
 * are you applying for?" about a resume that names the title in line two. A
 * document is not an instruction: it is several lines long, carries contact
 * details or the standard headings, and nothing in it was addressed to the
 * agent.
 */
function looksLikeResume(text) {
  const t = String(text || '');
  if (t.split('\n').filter((l) => l.trim()).length < 5) return false;
  const headings = (t.match(/^\s*(summary|objective|experience|work experience|education|skills|projects|certifications|achievements)\s*:?\s*$/gim) || []).length;
  const hasContact = RE_EMAIL_LINE.test(t) || RE_PHONE_LINE.test(t);
  return headings >= 2 || (headings >= 1 && hasContact) || (hasContact && t.split('\n').length >= 10);
}
const RE_EMAIL_LINE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const RE_PHONE_LINE = /(\+?\d[\d\s().-]{7,}\d)/;

/**
 * A job description pasted into the message, rather than answered into the
 * question that asks for one.
 *
 * "Tailor it to this job: Must have Python, AWS, Kubernetes…" was answered
 * with "paste the job description if you have it" — about a message that was
 * the job description. The posting is right there in the sentence; asking for
 * it again is the agent not reading what it was given.
 */
const RE_JD_SIGNAL = /\b(must[- ]have|nice[- ]to[- ]have|requirements?|responsibilities|we(?:'re| are) looking for|you will|qualifications|job description|required\s*:|preferred\s*:|tech(?:nical)? stack)\b/i;
function looksLikeJd(text) {
  const t = String(text || '');
  return t.length >= 40 && RE_JD_SIGNAL.test(t);
}
/** The posting itself, with any leading instruction to the agent removed. */
function jdBody(text) {
  return String(text)
    .replace(/^.{0,90}?\b(?:jd|job description|job|posting|role|opening)\b\s*[:\-–]\s*/i, '')
    .trim();
}

/** What the visitor wants, read from their sentence — Mega Agent command map. */
function commandOf(low, hasFile) {
  if (DO_ALL.test(low)) return 'doall';
  /* The popular-builder extra commands (references/popular-builder-features.md). */
  if (/\bmatch score\b|\bjobscan (this|it|me)?\b|\bmatch (it |this )?(against|with|to) the jd\b/.test(low)) return 'match';
  if (/\blinked.?in (headline|about|profile)\b|\bheadline and about\b/.test(low)) return 'linkedin';
  if (/\brecruiter view\b|\b6.second (scan|view|test)\b|\bsix.second\b/.test(low)) return 'recruiter';
  if (/\bfind (me )?jobs?\b|\bjob hunt\b|\bhunt for jobs\b|\bemail (the )?hr\b|\bapply to jobs\b/.test(low)) return 'jobs';
  if (/\bcover letter\b|\bcover\b.*\b(letter|note)\b/.test(low)) return 'cover';
  if (/\bcompare\b|which (job|jd|posting)|between these (jobs|jds)/.test(low)) return 'compare';
  if (/\binterview prep\b|\bprep\b|defen[cs]e|walk me through/.test(low)) return 'prep';
  if (/\bgap\b|what('?s| is) missing|why would this fail|missing keyword/.test(low)) return 'gap';
  /* Build beats score: "make a resume … and make it 98/100" is a build with
     a quality bar, not a raise of whatever was uploaded before. */
  if (BUILD_INTENT.test(low)) return 'build';
  /* "Why is it not 98", "why so low", "what is stopping it" — a question
     about the score, which raise answers by naming the blocking fact. It was
     falling through to the menu and asking for a resume already uploaded. */
  if (/\bwhy\b.*(not|only|so low|stuck|less)|what('?s| is) (stopping|blocking|missing)|why.*\d{2}\b/.test(low)) return 'raise';
  /* "make it 98/100" alone is its own command — exhaust the levers, then
     state the ceiling. Routing it to tailor is how it used to answer 90. */
  if (SCORE_INTENT.test(low)) return 'raise';
  if (/\btailor|rewrite|convert|recreate|make (it|this|my resume) ats|for (this|the) (jd|job|company)\b|\b(another|new) version for\b/.test(low) || FIX_INTENT.test(low)) return 'tailor';
  if (/\bscan|check|score|review|rate my|is this rejectable|ats.?(friendly|ready)\b/.test(low)) return 'check';
  if (/\bbuild|create|write|generate|new resume|from scratch|forge\b/.test(low)) return 'build';
  if (hasFile) return 'check'; /* a file with no words means "look at this" */
  return null;
}

/**
 * The delivery shape the Mega Agent prompt requires at the top of every
 * finished job, with the caveat that is never omitted: scores are proxies.
 */
function deliveryHeader(path, command, band, packet) {
  const lines = [`Path: ${path} · Command: ${command} · Band: ${band}`];
  if (packet) {
    lines.push(`Estimated checker: ${packet.after.checker}/${packet.after.checkerMax} (before ${packet.before.checker}) · Recruiter-scan: ${packet.after.recruiter}/100 (before ${packet.before.recruiter})`);
    const c = packet.detail.after.checker;
    /* The Rezi-style second line, mapped onto measured components. */
    lines.push(`Keyword ${c.keywords === null ? 'N/A' : c.keywords + '/40'} · Format ${c.parse}/30 · Complete ${c.structure}/15 · Evidence ${c.evidence}/15`);
    if (packet.ceiling) lines.push(packet.ceiling);
  }
  lines.push('Proxy only. Not a live Workday/Greenhouse decision — Greenhouse does not auto-score resumes.');
  return lines.join('\n');
}

/**
 * The choices offered alongside a question, when the answer comes from a
 * known set.
 *
 * Every list is capped — a wall of two hundred job titles is a worse prompt
 * than a blank box — and every list ends with a free-text escape, so nothing
 * here can stop somebody answering with the thing we did not think of. What
 * is offered narrows as the conversation learns: once a country is chosen,
 * the city list is that country's, and the employer list is who recruits
 * there.
 */
function optionsFor(field, session) {
  const d = (session && session.details) || {};
  const other = { label: 'Something else — I will type it', value: '' };

  if (field === 'target' || field === 'position') {
    /* Grouped, so a long list reads as a menu rather than a wall. */
    return {
      multi: false,
      groups: career.POSITION_GROUPS.map((g) => ({
        group: g.group,
        options: g.roles.map((r) => ({ label: r, value: r })),
      })),
      other,
    };
  }

  if (field === 'level') {
    return { multi: false, options: career.LEVELS.map((l) => ({ label: l.label, value: l.id })), other };
  }

  if (field === 'country') {
    /* If they named a company, its home market leads the list. */
    const home = d.company ? career.companyCountry(d.company) : null;
    const list = home
      ? [home, ...career.COUNTRIES.filter((c) => c !== home)]
      : career.COUNTRIES;
    return { multi: false, options: list.map((c) => ({ label: c, value: c })), other };
  }

  if (field === 'city') {
    const cities = career.citiesIn(d.country);
    if (!cities.length) return null;
    return { multi: false, options: cities.map((c) => ({ label: c, value: c })), other };
  }

  if (field === 'company') {
    const inMarket = d.country ? career.companiesHiringIn(d.country) : career.COMPANIES;
    const list = (inMarket.length ? inMarket : career.COMPANIES).slice(0, 40);
    return {
      multi: false,
      options: list.map((c) => ({ label: c.name, note: c.country, value: c.name })),
      other,
    };
  }

  if (field === 'photo') {
    return {
      multi: false,
      options: [
        { label: 'No photo', note: 'What most ATS markets expect', value: 'no' },
        { label: 'Include one', note: 'Common in parts of the EU and Asia', value: 'yes' },
      ],
      other,
    };
  }

  return null;
}

/**
 * The tailor step's mapping table, rendered.
 *
 * The skill has always required it — "JD term | in resume | where | action" —
 * and the reply never carried it, so a student who pasted a job description
 * got two score numbers and a list of missing words with no sign that the
 * posting had been read at all. This is that reading, shown.
 */
function jdMapBlock(map) {
  if (!map || !map.rows.length) return '';
  const lines = [
    `Read from the posting: ${map.must} must-have${map.must === 1 ? '' : 's'}` +
    (map.nice ? ` and ${map.nice} nice-to-have${map.nice === 1 ? '' : 's'}` : '') +
    `. ${map.evidenced} evidenced in your resume${map.listedOnly ? `, ${map.listedOnly} listed without proof` : ''}.`,
    '',
    '| JD term | Have it | Where | Action |',
    '|---|---|---|---|',
  ];
  const mark = { evidenced: 'yes', 'listed only': 'listed only', 'not claimed': 'no' };
  map.rows.slice(0, 14).forEach((r) => {
    const term = r.kind === 'nice' ? `${r.term} *(nice to have)*` : r.term;
    lines.push(`| ${term} | ${mark[r.status]} | ${r.where} | ${r.action} |`);
  });
  if (map.mustMissing.length) {
    lines.push('', `Required and unproven: ${map.mustMissing.join(', ')}. Nothing was added for these — say where you used one and it goes in.`);
  }
  return lines.join('\n');
}

/**
 * Facts a build can take from a resume already in the session.
 *
 * A recording caught this: someone uploaded Bishal_Nag_DevOps_Cloud_Engineer_
 * Resume.pdf, watched it score, then asked for a Full-Stack resume — and was
 * told "it would go out saying your name is missing. What should it be?"
 * about a document whose first line is their name. BUILD read only the
 * interview answers, and the upload was not one.
 *
 * Only the facts that do not depend on the target role are carried across.
 * Their name, address and phone number are theirs whatever they apply for; a
 * DevOps work history is not the evidence for a Full-Stack page, so the
 * interview still asks for the parts that changed.
 */
function detailsFromResume(resumeText) {
  const text = String(resumeText || '').trim();
  if (!text) return {};
  const led = atsEngine.factLedger(text);
  const out = {};
  if (led.name) out.name = led.name;
  if (led.email) out.email = led.email;
  if (led.phone) out.phone = led.phone;
  if (led.link) out.linkedin = led.link;
  if (led.education.length) out.education = led.education.join('\n');
  return out;
}

/** A fact ledger shaped from interview answers, so the same question engine
    serves BUILD, where there is no resume to parse yet. */
function ledgerFromDetails(d) {
  const items = (v) => splitItems(v);
  const skills = items(d.skills);
  return {
    name: d.name || null,
    email: d.email || null,
    phone: d.phone || null,
    link: d.linkedin || d.github || null,
    summaryLines: [],
    roles: items(d.experience).map((e) => ({ header: '', hasDates: /\d{4}/.test(e), bullets: [e] })),
    projects: items(d.projects).map((p) => ({ name: '', bullets: [p] })),
    education: items(d.education),
    certifications: items(d.certifications),
    statedSkills: skills,
    /* The interview asked for tools they can defend, so stating them is the
       evidence BUILD has. The scan of the finished page re-checks honestly. */
    evidencedSkills: skills,
    unevidencedSkills: [],
    impliedSkills: [],
    sectionsFound: [],
    words: 0,
  };
}

/**
 * The experience block, rebuilt from every part of it.
 *
 * It used to be assembled inside whichever answer arrived last, from that
 * answer plus the dates — so answering the stipend question after describing
 * two more achievements rebuilt the block without them, and the two bullets
 * the student had just typed were gone from the page. Every part is read
 * every time, so the order the questions are answered in stops mattering.
 */
function rebuildExperience(d) {
  if (!d.internship) return;
  /* Header line first so the dates parse, then the work beneath it — and the
     work is what is LEFT after the header, not the whole answer, or the page
     says the heading twice. */
  const text = String(d.internship).trim();
  const cut = text.search(/[.\n]/);
  const first = cut > 0 ? text.slice(0, cut).trim() : text;
  const rest = cut > 0 ? text.slice(cut + 1).trim() : '';
  const header = [first, d.internshipdates].filter(Boolean).join(' | ');
  const paid = d.stipend === 'paid' ? ' (paid internship)' : '';
  d.experience = [header + paid, rest, d.internship2, d.internship3]
    .filter(Boolean).join('\n');
}

/** Where each interview answer lands. */
function consumeAnswer(session, field, msg) {
  const skip = /^(skip|no|none|nothing|na|n\/a|not now)\.?$/i.test(msg.trim());
  /* A declined question is settled, not pending. Without this, "skip" left
     the fact absent, the ledger regenerated the same question, and the agent
     asked it again every turn — the exact repeat-loop this rewrite removes. */
  if (skip) {
    session.declined = session.declined || [];
    if (!session.declined.includes(field)) session.declined.push(field);
    return;
  }
  if (field === 'target') {
    /* One fact, two names. The engine's script calls it the target and the
       interview bank calls it the position, so answering either used to leave
       the other unanswered — and the person was asked their job title twice,
       in two wordings, which reads as an agent that was not listening. */
    session.target = msg.trim();
    session.details.position = session.details.position || msg.trim();
    session.details.role = session.details.role || msg.trim();
    return;
  }
  if (field === 'jd') { session.jd = msg.trim(); return; }
  if (field === 'resume') { session.resumeText = msg; return; }

  const d = session.details;
  /* Stored under both names: the builder reads `linkedin`, the cover letter
     reads `link`, and one answer has to satisfy whichever asked. */
  if (field === 'link') { d.linkedin = msg.trim(); d.link = msg.trim(); }
  /*
   * The interview's answers, folded into the shapes the builder writes from.
   *
   * The bank asks in the language a person thinks in — "which degree", "which
   * college", "which years", "was it paid" — and the page needs one education
   * line and one dated role. Assembling them here keeps the questions human
   * and the document correct, and means an answer given to any command is
   * available to all three.
   */
  else if (field === 'degree' || field === 'college' || field === 'gradyear') {
    d[field] = msg.trim();
    d.education = [d.degree, d.college, d.gradyear].filter(Boolean).join(', ');
  } else if (field === 'internship2' || field === 'internship3') {
    d[field] = msg.trim();
    rebuildExperience(d);
  } else if (field === 'projects2') {
    /* The flag is set as well as the text: appending only to `projects` left
       the question's own condition true, so it asked for a second project
       twelve times in a row. */
    d.projects2 = msg.trim();
    d.projects = [d.projects, msg.trim()].filter(Boolean).join('\n');
  } else if (field === 'internship' || field === 'internshipdates' || field === 'stipend') {
    d[field] = msg.trim();
    rebuildExperience(d);
  } else if (field === 'github' || field === 'linkedin') {
    d[field] = msg.trim();
    d.link = d.link || msg.trim();
  } else if (field === 'pickprojects') {
    /* "all" takes the lot; otherwise only the repos they named. Matching on
       the label as well as the bullet, because a chip sends its value but a
       typed answer is the project's name. */
    const picks = String(msg).split(/\s*[,;\n]\s*/).map((s) => s.trim()).filter(Boolean);
    const all = session.githubProjects || [];
    const chosen = /^\s*all\s*$/i.test(msg)
      ? all
      : all.filter((b) => picks.some((p) => b.toLowerCase().includes(p.toLowerCase())));
    if (chosen.length) {
      d.projects = [d.projects, ...chosen].filter(Boolean).join('\n');
      d.hasprojects = 'yes';
    }
    /*
     * The languages those repos are written in are a suggestion for the
     * skills question, never an answer to it. Filling `skills` here meant the
     * question was never asked, so a student who would have said "Java,
     * Spring Boot, REST API" got the languages of their GitHub instead — the
     * agent answering on their behalf, with facts about a different stack.
     */
  } else if (field === 'position') {
    d.position = msg.trim();
    d.role = d.role || msg.trim();
    if (!session.target) session.target = msg.trim();
  }
  else if (field === 'more' || field === 'metric' || field === 'evidence' || field === 'dates' || field === 'confirmkw') {
    /* Their words, added to their history — placement the rewriter can use.
       For confirmkw this is the Rezi-style confirmation: naming where a JD
       term was used is what makes it claimable. */
    d.experience = [d.experience, msg.trim()].filter(Boolean).join('\n');
    /*
     * Added to the resume itself, not only to the interview answers.
     *
     * Only confirmkw did this, so the raise command would ask for the fact
     * holding the score down — "one more evidenced skill the target role
     * asks for" — receive it, and then re-score the untouched document and
     * report the identical ceiling. The person had answered the question and
     * watched nothing happen, which is the complaint this portal gets most.
     *
     * Appended under an Experience heading rather than at the tail of the
     * file: the tail belongs to whatever section came last, and a fact filed
     * under Skills is a fact the ledger mangles instead of proving.
     */
    if (session.resumeText) {
      /*
       * A fact is only made into a bullet if it reads like one.
       *
       * Every answer was appended as "- <whatever they typed>", so a page
       * came back carrying "- Built 12 records and 500 users", "- Delivered
       * jan 2026 - present" and "- Implemented aug 2026-presernt": a bare
       * measurement and two date ranges, each with a verb bolted on, sitting
       * among real achievements. A date belongs on the role header, and a
       * number on its own is not a claim about anything.
       */
      const t = msg.trim();
      const bareDate = RE_DATE_RANGE.test(t) && t.split(/\s+/).length <= 6;
      const bareNumber = /^[\d\s,.%+-]+$|^\d[\w\s,.%+-]{0,24}$/.test(t);
      if (bareDate) {
        /* Attach it to the most recent role header rather than list it. */
        session.resumeText = session.resumeText.replace(
          /^([^\n]*\|[^\n]*)$/m, (line) => (RE_DATE_RANGE.test(line) ? line : `${line} | ${t}`));
      } else if (!bareNumber && t.split(/\s+/).length >= 4) {
        session.resumeText += `\n\nExperience\n- ${t}`;
      }
    }
  } else d[field] = msg.trim();

  /* Answers about a scanned resume also extend its text, so tailor and gap
     see the new facts. Verbatim — these are the student's own statements. */
  if (session.resumeText && ['email', 'phone', 'name', 'link'].includes(field)) {
    session.resumeText += `\n${msg.trim()}`;
  }
}

/** One question, exactly one, per the skill: the next the ledger cannot answer. */
function nextQuestion(session) {
  const ledger = session.resumeText
    ? atsEngine.factLedger(session.resumeText)
    : ledgerFromDetails(session.details);
  const d = session.details || {};
  const iv = atsEngine.interviewQuestions(ledger, {
    target: session.target,
    jd: session.jd,
    /* Answers already given, so a question is never asked twice. */
    photoAnswered: Boolean(d.photo),
    location: d.location,
    educationAsked: Boolean(d.degree || d.college || d.gradyear || d.education),
  });
  /*
   * The bank owns identity, links, skills, projects and education; the engine
   * keeps the questions only it can generate — the evidence and metric probes
   * that come out of reading the actual bullets. Asked from both, a student
   * got their links requested twice in two wordings and their projects twice.
   */
  const OWNED_BY_BANK = ['name', 'email', 'phone', 'link', 'skills', 'projects', 'education'];
  iv.questions = iv.questions.filter((q) => !OWNED_BY_BANK.includes(q.field));
  /* Declined questions stay answered — "skip" is an answer. */
  const declined = session.declined || [];
  const open = iv.questions.filter((q) => !declined.includes(q.field));
  return { iv, question: open[0] || null };
}

/** The finished job, in one response the client already knows how to render. */
function deliver(res, session, packetOrBuilt, kindNote) {
  const isPacket = Boolean(packetOrBuilt.resume);
  const text = isPacket ? packetOrBuilt.resume : packetOrBuilt.text;
  const command = session.command;
  session.asked = null;
  session.command = null; /* done — the next message starts fresh, with the facts kept */

  /* A shipped resume is what cover and prep are allowed to work from. */
  session.shipped = { text, target: session.target, jd: session.jd };

  /*
   * The improved page becomes the working copy.
   *
   * Without this, every later "fix it" re-converted the ORIGINAL upload and
   * returned a byte-identical document — a person asking to improve it more
   * got exactly what they already had, again and again, which is what the
   * repeated-mistake reports were describing. Improvement has to compound,
   * and the score has to be remembered so a second pass can tell whether it
   * actually moved.
   */
  session.resumeText = text;
  session.lastScore = (scanResume(text, session.target) || {}).score;
  if (isPacket) {
    session.lastPacket = {
      band: packetOrBuilt.band,
      notClaimed: packetOrBuilt.notClaimed,
      after: packetOrBuilt.after,
      dropped: packetOrBuilt.essentials.dropped,
    };
  }

  const header = isPacket
    ? `Seat: RESUME · ${deliveryHeader('A', command || 'tailor', packetOrBuilt.band, packetOrBuilt)}`
    : `Seat: RESUME · Command: ${command || 'build'} · Band: Scratch\nProxy only. Not a live Workday/Greenhouse decision — Greenhouse does not auto-score resumes.`;

  return res.json({
    ok: true, kind: 'build',
    reply: [header, kindNote].filter(Boolean).join('\n\n'),
    text,
    report: scanResume(text, session.target),
    missing: isPacket ? [] : packetOrBuilt.missing,
    potentialScore: isPacket ? undefined : packetOrBuilt.potentialScore,
    details: session.details,
    packet: isPacket ? packetOrBuilt : undefined,
    session,
  });
}

router.post('/chat', upload.single('file'), async (req, res) => {
  const b = bodyOf(req);
  const msg = String(b.message || '').trim();
  const low = msg.toLowerCase();

  /* The session rides the request; a first turn starts one. */
  let session;
  try { session = b.session ? JSON.parse(b.session) : null; } catch (e) { session = null; }
  if (!session || typeof session !== 'object') session = { command: null, details: {}, resumeText: '', target: '', jd: '', asked: null };
  if (!session.details) session.details = {};

  try {
    const uploaded = await textFromUpload(req.file);
    if (uploaded) session.resumeText = uploaded;
    if (b.target) session.target = b.target;
    if (b.jd) session.jd = b.jd;

    /* A block of pasted "field: value" lines is answers in bulk, not chat. */
    const bulk = parseDetails(msg);
    if (Object.keys(bulk).length >= 2) {
      Object.assign(session.details, bulk);
      if (bulk.role) session.target = session.target || bulk.role;
      session.asked = null;
    }

    /* Command words win over a pending question — "check this instead" is a
       change of direction, not an answer to "what is your email". */
    /* An answer to a paste-type question is an answer, whatever words it
       contains — a JD saying "build scalable systems" or "Building
       dashboards" must never be read as the build command and hijack the
       conversation mid-answer. Only short conversational replies to other
       question types may still switch command. */
    const PASTE_FIELDS = ['resume', 'jd', 'jds', 'confirmkw'];
    const looksLikePaste = session.asked &&
      (PASTE_FIELDS.includes(session.asked) || msg.split('\n').length > 3 || msg.length > 200);

    /*
     * A resume pasted into the box is the resume, whatever verbs it happens to
     * contain — the first thing to do with it is look at it, exactly as with
     * an uploaded file. Without this the paste was parsed as a sentence, and
     * "2 years building services" made it a request to build a new one.
     */
    const pastedResume = !session.asked && !req.file && looksLikeResume(msg);
    if (pastedResume) session.resumeText = msg;

    /* A posting in the message is the posting. Captured before the command is
       read, so "tailor it to this job: …" tailors against it instead of
       asking for what it was just handed. */
    if (!pastedResume && !PASTE_FIELDS.includes(session.asked) && looksLikeJd(msg)) {
      session.jd = jdBody(msg);
    }

    const command = pastedResume ? 'check'
      : looksLikePaste ? null
        : commandOf(low, Boolean(req.file));
    if (command) {
      session.command = command;
      session.menuShown = false;

      /*
       * A role named in the request is the target, and it replaces whatever
       * the last upload implied: someone asking for a software developer
       * resume is not asking about their DevOps history.
       */
      const stated = targetFromSentence(low);
      if (stated) {
        session.target = stated;
        session.details.role = stated;
        if (command === 'build') {
          /* Building for a new role starts from their answers, not from the
             file they scanned earlier — otherwise the old resume comes back
             wearing a new title. */
          session.resumeText = '';
          session.declined = [];
          session.tailorAsked = 0;
        }
      }

      /* "and make it 98/100" is a goal carried into the build, honoured once
         the page exists rather than instead of making one. */
      if (command === 'build' && SCORE_INTENT.test(low)) {
        session.raiseAfterBuild = parseInt((low.match(/\b(\d{2})\s*(?:\/\s*100)?\b/) || [])[1], 10) || 98;
      }
      /* "Fix it" while being asked for a job title is not a title — it is
         "just fix it, without one". Settle the question and move, or the
         agent re-asks and the visitor re-answers the same words forever. */
      if (session.asked === 'target' && command === 'tailor' && FIX_INTENT.test(low) && !/\btailor|engineer|developer|analyst|designer|manager\b/.test(low)) {
        session.declined = session.declined || [];
        if (!session.declined.includes('target')) session.declined.push('target');
      }
      if (session.asked && ['target', 'jd', 'resume'].includes(session.asked) === false) session.asked = null;
    } else if (session.asked && msg) {
      /* A document is a document wherever it lands. A resume pasted while
         the pending question was "what job title?" must become the ledger
         source, not a job title five hundred characters long. */
      const resumey = msg.split('\n').length > 5 &&
        (RE_EMAIL.test(msg) || /\b(experience|skills|education|projects)\b/i.test(msg));
      if (!PASTE_FIELDS.includes(session.asked) && resumey) {
        session.resumeText = msg;
        if (session.command === 'build') session.command = 'tailor';
        session.asked = null;
      } else {
        consumeAnswer(session, session.asked, msg);
        session.asked = null;
      }
    }

    /* A long paste that reads like a resume is one — whether it arrived
       unannounced or glued to the command that asked about it ("check this:"
       followed by the resume). Ignoring the second case asked the visitor to
       attach the thing they had just pasted. */
    if (!session.resumeText.trim() && msg.split('\n').length > 5 &&
        (msg.length > 300 || RE_EMAIL.test(msg) || /\b(experience|skills|education|projects)\b/i.test(msg))) {
      session.resumeText = msg;
      if (!session.command) session.command = 'check';
    }

    /* Reply shape from the ten-resume-agent skill: line 1 names the command,
       then the work or one question — never a greeting, never the menu. */
    /* The router's reply shape: seat, then command, then the work or one
       question. Never a greeting, never the menu. */
    /*
     * One question, and never the same one twice in a row.
     *
     * A recording caught the loop this exists to stop: asked for a name, the
     * person typed "build for google", the word "build" re-triggered the
     * build command, the pending question was discarded unanswered, and the
     * identical sentence came back — "I can lay the page out, but it would
     * go out saying your name is missing. What should it be?" — word for
     * word. From the outside that is an agent that cannot hear.
     *
     * Repeating a question is now itself the signal that the last exchange
     * did not land, so the second attempt says so and offers the way out
     * instead of restating.
     */
    const ask = (field, question, note) => {
      const repeat = session.lastAsk === question;
      session.lastAsk = question;
      session.asked = field;
      const head = session.command ? `Seat: RESUME · Command: ${session.command}` : null;
      const body = repeat
        ? `${question}\n\nI asked this a moment ago and I do not have it yet — your last message did not read as an answer to it. Reply with just the value, or say "build it anyway" and I will ship the draft without it.`
        : question;
      /*
       * Answers to pick from, where the answer comes from a known set.
       *
       * A blank prompt is the hardest kind of question. "Which company is
       * the letter for?" got back "amazon" and nothing else, and a letter
       * was written on that alone. Offering the options turns the question
       * into a choice — and every list ends in a free-text escape, because a
       * menu you cannot answer outside of is worse than no menu.
       */
      /* The interview bank knows its own answer sets; the older per-field map
         still covers the questions the engine generates. */
      const entry = interview.BANK.find((q) => q.field === field);
      const choices = (entry && interview.optionsFor(entry, session.details)) ||
        optionsFor(field, session);
      return res.json({
        ok: true,
        kind: 'ask',
        reply: [head, note, body].filter(Boolean).join('\n\n'),
        options: choices || undefined,
        session,
      });
    };

    /*
     * One question from the shared bank, with the progress left to run.
     *
     * A person answering eight questions deserves to know it is eight. The
     * count also keeps the agent honest: if the bank has nothing left, the
     * command must build rather than invent another thing to ask.
     */
    const askInterview = (command, note) => {
      const ledger = session.resumeText.trim() ? atsEngine.factLedger(session.resumeText) : null;
      const q = interview.nextFor(command, session.details, ledger, session.declined || []);
      if (!q) return null;
      const left = interview.remainingFor(command, session.details, ledger, session.declined || []).length;
      const progress = left > 1 ? `${q.group} · ${left} to go, and you can skip any of them.` : q.group;
      return ask(q.field, q.question, [note, progress].filter(Boolean).join('\n\n'));
    };

    /* ── dispatch ── */

    /*
     * doall — the pipeline, as the router skill maps the button: check
     * first; Weak means the rebuild interview; a JD means tailor; otherwise
     * the check report IS the answer. Never four menus.
     */
    if (session.command === 'doall') {
      if (!session.resumeText.trim()) {
        session.command = 'build';
        const q = nextQuestion(session).question;
        if (q) return ask(q.field, q.question);
      } else {
        session.command = session.jd ? 'tailor' : 'check';
      }
    }

    if (session.command === 'check') {
      if (!session.resumeText.trim()) {
        return ask('resume', 'Attach your resume (PDF or TXT) with the clip, or paste its text here.');
      }
      const report = scanResume(session.resumeText, session.target);
      const packet = atsEngine.rewriteResume(session.resumeText, { target: session.target, jd: session.jd });

      /*
       * The band must agree with the number on the card. The card shows the
       * nine-check score and the band came from the engine's dual rubric —
       * two honest scorers, but a screen reading "62/100" beside the word
       * "Strong" is the product contradicting itself. The stricter of the two
       * wins, so the label can never flatter the score the student is looking
       * at.
       */
      const cardBand = report.score < 50 ? 'weak' : report.score < 80 ? 'salvageable' : 'strong';
      const RANK = { weak: 0, salvageable: 1, strong: 2 };
      if (RANK[cardBand] < RANK[packet.band]) packet.band = cardBand;

      if (packet.band === 'weak') {
        /* v5.1 check, step 7: say the rebuild is coming, ask Block 1 Q1 only. */
        session.command = 'tailor';
        const q = nextQuestion(session).question;
        const prompt = `This file would likely bounce (estimated checker ${packet.before.checker}/${packet.before.checkerMax}, recruiter-scan ${packet.before.recruiter}). Band: Weak — I will rebuild it rather than polish it. A few questions first.`;
        if (q) return ask(q.field, q.question, prompt);
      }

      session.command = null;
      return res.json({
        ok: true, kind: 'scan', report,
        band: packet.band,
        prompt: packet.band === 'salvageable' ? 'Band: Salvageable — say "tailor" (add the JD if you have it) and I will convert it, keeping every true fact.' : null,
        interview: packet.interview,
        rebuilt: { text: packet.resume, packet },
        session,
      });
    }

    /*
     * raise — "make it 98/100". Runs every honest lever, then either ships at
     * the target or names the single fact that is holding the number down.
     * It never answers 90 and stops, and it never invents the fact.
     */
    if (session.command === 'raise') {
      if (!session.resumeText.trim() && !Object.keys(session.details).length) {
        session.command = 'build';
        const q = nextQuestion(session).question;
        if (q) return ask(q.field, q.question, 'Nothing to raise yet — let us build it first.');
      }
      const source = session.resumeText.trim() ||
        Object.entries(session.details).map(([k, v]) => `${k}: ${v}`).join('\n');
      /*
       * The number they asked for, not the one we prefer.
       *
       * A person who says "make it 91" is asking for 91 — perhaps because a
       * portal filters there, perhaps because they want it done and stopped.
       * The target is read from their sentence, remembered across the
       * follow-up question (whose answer contains no number of its own, so
       * re-parsing it silently reset the goal to 98), and stated back so they
       * can see which bar is being worked to.
       */
      const stated = parseInt((low.match(/\b(\d{2})\s*(?:\/\s*100)?\b/) || [])[1], 10);
      const goal = Math.min(100, Math.max(1, stated || session.pendingRaise || 98));
      session.pendingRaise = goal;
      const out = raiseToTarget(source, session.target, session.jd, goal);

      session.resumeText = out.text; /* the climb is kept for the next turn */

      if (out.reached) {
        session.command = 'raise';
        session.pendingRaise = null;
        return deliver(res, session, { text: out.text, report: out.report, missing: [], potentialScore: out.report.score },
          `You asked for ${goal}. Checker ${out.report.score}/100 — every parse, heading, verb and keyword lever spent on true facts. Nothing was invented to get here.`);
      }

      /*
       * The bullet worklist, once formatting has nothing left to give.
       *
       * Asked to raise the same page a second time, this used to re-run two
       * levers that were already spent and return the identical ceiling
       * sentence — the same score, the same words, every time, which is what
       * "no improvement when asked" looks like from the outside. The score has
       * genuinely stopped moving; what has not been said is WHICH line is
       * holding it down and what is missing from it. That is per-bullet work,
       * and it is the thing every good builder does that this one did not.
       */
      session.raiseRounds = (session.raiseRounds || 0) + 1;

      /*
       * When the page is simply short, ask for more of their history.
       *
       * Length is the one check no formatting lever can move: the words have
       * to come from somewhere, and the only honest somewhere is the person.
       * A resume built from one internship and two projects lands at 165
       * words and stops at 96 — so the agent asks what else they have done,
       * and each answer adds real content and real points. It stops asking
       * when they stop answering.
       */
      /*
       * Only a SHORT page is asked for more.
       *
       * The length check fires at both ends, and this read it as one signal:
       * a 993-word resume — comfortably over a page — was told "3 of the
       * missing points are page length" and then asked "anything else? a
       * second project, a competition, a paper", which is the opposite of
       * what that page needs. Too long is a cutting problem, and cutting is
       * something the agent can do itself.
       */
      const lengthLoss = out.failing.find((f) => f.id === 'length');
      const words = String(out.text || '').split(/\s+/).filter(Boolean).length;
      const short = lengthLoss && words < 250 ? lengthLoss : null;
      session.moreAsked = session.moreAsked || 0;
      if (short && short.lost >= 2 && session.moreAsked < 4 &&
          !(session.declined || []).includes('more')) {
        session.moreAsked += 1;
        const prompts = [
          'The page is short for a full sheet, and length is the only thing left that formatting cannot fix — the words have to be yours. What else have you done? Another role, a freelance piece, a hackathon, a college project, coursework you built something for.',
          'Anything else? A second project, an open-source contribution, a competition, a paper, a club you built something for.',
          'One more if there is one — teaching, tutoring, a volunteer build, a tool you made for yourself that other people ended up using.',
          'Last one. Anything you have built or run that is not on the page yet?',
        ];
        session.command = 'raise';
        return ask('more', prompts[Math.min(session.moreAsked - 1, prompts.length - 1)],
          `You asked for ${goal}. It is at ${out.report.score}/100 — ${short.lost} of the missing points are page length.`);
      }

      if (session.raiseRounds >= 2) {
        const audit = atsEngine.bulletAudit(out.text);
        /* Bullets already put to them, so the next round takes the next line
           instead of re-printing the same worklist at somebody who has read
           it. Asking the same question twice is the bug this whole pass is
           about; asking about a different line every time is the work. */
        /*
         * The five worst lines, not all of them.
         *
         * A recording caught this offering to walk somebody through their
         * bullets one at a time and telling them "54 left after this one".
         * Nobody answers fifty-five questions about their own resume, and
         * being told how many are left is discouragement rather than help.
         * A page with that many weak lines has a length problem, which the
         * trim lever now solves; what survives is a handful worth fixing by
         * hand, and those are worked worst-first.
         */
        const QUEUE = 5;
        session.bulletsAsked = session.bulletsAsked || [];
        const queue = [...audit.weak]
          .sort((a, b) => b.problems.length - a.problems.length)
          .slice(0, QUEUE);
        const pending = queue.filter((r) => !session.bulletsAsked.includes(r.text));

        if (pending.length) {
          const target = pending[0];
          session.bulletsAsked.push(target.text);
          const firstRound = session.raiseRounds === 2;
          return res.json({
            ok: true,
            kind: 'help',
            reply: [
              'Seat: RESUME · Command: raise',
              firstRound
                ? `Checker ${out.report.score}/100 and formatting is spent — the rest of the points are in the lines themselves. ${audit.strong}/${audit.total} bullets already pull their weight. These are the ${queue.length} worth fixing first${audit.weak.length > queue.length ? `, out of ${audit.weak.length}` : ''}.`
                : `Checker ${out.report.score}/100. Next one.`,
              '',
              ...(firstRound ? [
                '| Line | What is wrong | What fixes it |',
                '|---|---|---|',
                ...queue.map((r) =>
                  `| ${r.text.replace(/\|/g, '\\|')} | ${r.problems.join('; ')} | ${(r.fix || '').replace(/\|/g, '\\|')} |`),
                '',
              ] : []),
              `**${target.text}**`,
              target.problems.length ? `Wrong with it: ${target.problems.join('; ')}.` : '',
              target.ask
                ? target.ask.question
                : `${target.fix} Give me the line as it should read and I will put it in.`,
            ].filter(Boolean).join('\n'),
            options: target.ask
              ? {
                multi: false,
                options: target.ask.kinds.map((k) => ({ label: k.label, note: k.hint, value: k.label })),
                other: { label: 'Something else — I will type it', value: '' },
              }
              : undefined,
            session: Object.assign(session, { asked: 'metric', command: 'raise' }),
          });
        }

        /*
         * Every weak line has been put to them. Say so once — and only once.
         *
         * Repeating "I have asked about every line" is the same failure the
         * whole pass is about, so the second time round the page is simply
         * delivered with its honest score.
         */
        if (audit.weak.length && !session.toldExhausted) {
          session.toldExhausted = true;
          session.command = null;
          return res.json({
            ok: true, kind: 'help',
            reply: [
              'Seat: RESUME · Command: raise',
              `Checker ${out.report.score}/100, and I have asked about every line that is holding it there — ${audit.weak.length} of them. None of the remaining points are formatting, so there is nothing left for me to spend.`,
              'Give me a number for any of those lines, or a project that shows the target role\'s stack, and the score moves the same turn. Otherwise this is the honest version.',
            ].join('\n\n'),
            session,
          });
        }
      }

      /* One question, the one worth the most points. */
      if (out.needFact && !(session.declined || []).includes('raise-' + out.needFact.id)) {
        session.declined = session.declined || [];
        session.declined.push('raise-' + out.needFact.id);
        session.pendingRaise = goal;
        return ask('metric',
          `You asked for ${goal}. It is at ${out.report.score}/100 and the formatting levers are spent — the next ${out.needFact.lost} points need ${out.needFact.ask}. Give me that and I will finish the climb to ${goal} — or say skip and I will ship this honestly at ${out.report.score}.`);
      }

      /* Ceiling stated, exactly as the rule requires. */
      session.command = 'raise';
      session.pendingRaise = null;
      const ceiling = [
        `You asked for ${goal}. Ceiling: Checker ${out.report.score}/100.`,
        out.needFact
          ? `To reach ${goal} I need ${out.needFact.ask}. I will not invent it.`
          : `The remaining points need facts your history does not show. I will not invent them.`,
        out.failing.length ? `Still costing points: ${out.failing.slice(0, 3).map((f) => `${f.id} (${f.lost})`).join(', ')}.` : '',
      ].filter(Boolean).join(' ');
      return deliver(res, session, { text: out.text, report: out.report, missing: [], potentialScore: goal }, ceiling);
    }

    if (session.command === 'tailor') {
      if (!session.resumeText.trim() && !Object.keys(session.details).length) {
        /* The button map: "make it 98/100" with no resume means build — ask
           the job title, not for a document they already said they lack. */
        session.command = 'build';
        const q = nextQuestion(session).question;
        if (q) return ask(q.field, q.question);
      }
      if (!session.target && !session.jd && !(session.declined || []).includes('target')) {
        return ask('target', 'What job title are you applying for — for example Backend Engineer, Data Analyst, or something else? Paste the job description instead if you have it.');
      }
      /* v5.1 tailor: at most 5 discovery questions, one per turn, then write.
         The counter is the guarantee this can never become an interrogation. */
      const { iv, question } = nextQuestion(session);
      session.tailorAsked = session.tailorAsked || 0;
      if (question && session.tailorAsked < 5 && !iv.canBuild) {
        session.tailorAsked += 1;
        return ask(question.field, question.question);
      }
      if (question && session.tailorAsked < 5 && ['email', 'phone', 'metric', 'dates'].includes(question.field)) {
        session.tailorAsked += 1;
        return ask(question.field, question.question);
      }

      /* The keyword confirm the Mega Agent spec takes from Rezi: before the
         rewrite, JD terms with no evidence get one question — "is this real
         in your experience?" — and only a named answer turns into evidence.
         A skill is never added on the agent's initiative. */
      if (session.jd && session.tailorAsked < 5 && !(session.declined || []).includes('confirmkw')) {
        const probe = atsEngine.rewriteResume(
          session.resumeText.trim() || Object.entries(session.details).map(([k, v]) => `${k}: ${v}`).join('\n'),
          { target: session.target, jd: session.jd });
        if (probe.notClaimed.length) {
          session.tailorAsked += 1;
          session.declined = session.declined || [];
          session.declined.push('confirmkw'); /* asked once, never looped */
          return ask('confirmkw',
            `The JD asks for ${probe.notClaimed.slice(0, 5).join(', ')} and your resume shows no evidence of them. Have you actually used any? Name where — one line each, e.g. "Docker — containerised the billing service" — or say skip and they stay on the Not-claimed list.`);
        }
      }
      const source = session.resumeText.trim() || Object.entries(session.details)
        .map(([k, v]) => `${k}: ${v}`).join('\n');
      const packet = atsEngine.rewriteResume(source, { target: session.target, jd: session.jd, mode: 'CONVERT' });

      /*
       * A second conversion of an already-converted page changes nothing, and
       * reprinting the identical document is how this agent looked broken.
       * When there is no gain left, say what is actually blocking the score
       * instead of handing back the same page with the same numbers.
       */
      /*
       * Compared against what was last handed over, not against the input.
       * Comparing to the source never matched — the rewriter always changes
       * something on a first pass — so the guard never fired and the same
       * document went out three times in a row.
       */
      const sameAsLast = session.shipped &&
        packet.resume.replace(/\s+/g, ' ').trim() === String(session.shipped.text).replace(/\s+/g, ' ').trim();
      if (sameAsLast) {
        const blocked = raiseToTarget(source, session.target, session.jd, 98);

        /*
         * Explained once, then acted on. Repeating the same explanation to
         * someone asking a third time is the same failure in a politer voice,
         * so the follow-up asks for the fact that would actually move the
         * score instead of restating why it will not move on its own.
         */
        /*
         * Each repeat moves the conversation on rather than restating: the
         * reason, then the request for the fact, then the ceiling and a stop.
         * Saying the same sentence three times is the bug wearing manners.
         */
        session.convertedRepeats = (session.convertedRepeats || 0) + 1;

        if (session.convertedRepeats === 2 && blocked.needFact) {
          session.command = 'raise';
          return ask('metric',
            `Still ${blocked.report.score}/100, and formatting cannot add another point. Give me ${blocked.needFact.ask} and I will put it in — or say skip and this is the honest version.`);
        }

        if (session.convertedRepeats >= 3) {
          session.command = null;
          return res.json({
            ok: true, kind: 'help',
            reply: [
              'Seat: RESUME · Command: tailor',
              `Ceiling reached: ${blocked.report.score}/100 on these facts. I have spent every formatting lever and I will not invent the rest.`,
              'Three things would move it, and all three are yours to supply: a real number on your strongest bullet, a skill the target role asks for that you have actually used, or a project that shows it.',
              'Otherwise this is the honest version — download it and apply.',
            ].join('\n\n'),
            session,
          });
        }

        session.toldAlreadyConverted = true;
        session.command = null;
        return res.json({
          ok: true, kind: 'help',
          reply: [
            'Seat: RESUME · Command: tailor',
            'This page is already converted — re-running it produces the same document, so nothing was changed.',
            blocked.needFact
              ? `What is holding the score at ${blocked.report.score}/100 is a fact, not formatting: ${blocked.needFact.ask}. Give me that and I will use it.`
              : 'The remaining points need evidence your history does not show. I will not invent it.',
            packet.notClaimed.length ? `Not claimed: ${packet.notClaimed.slice(0, 6).join(', ')}.` : '',
          ].filter(Boolean).join('\n\n'),
          session,
        });
      }

      return deliver(res, session, packet, [
        `Band before: ${packet.band}. Converted — checker ${packet.before.checker}→${packet.after.checker}, recruiter-scan ${packet.before.recruiter}→${packet.after.recruiter}.`,
        jdMapBlock(packet.jdMap),
      ].filter(Boolean).join('\n\n'));
    }

    /*
     * match — the Jobscan-style screen: score AND gap table in one reply,
     * with the 65–80% band and the stuffing warning above it.
     */
    if (session.command === 'match') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume to match.');
      if (!session.jd) return ask('jd', 'Paste the job description — the match is measured against its wording.');
      const packet = atsEngine.rewriteResume(session.resumeText, { target: session.target, jd: session.jd });
      const kd = packet.detail.before.checker.keywordDetail || { matched: 0, terms: 0, overlap: 0 };
      const bandNote = kd.overlap > 80
        ? 'Above 80% reads as keyword stuffing to a reviewer — trim repeats rather than adding more.'
        : kd.overlap >= 65 ? 'Inside the 65–80% competitive band.'
          : `Below the 65–80% competitive band — ${packet.notClaimed.length} term(s) missing.`;
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          'Command: match',
          `Match: ${kd.overlap}% evidenced overlap (${kd.matched}/${kd.terms} hard terms) · checker ${packet.before.checker}/${packet.before.checkerMax} · recruiter-scan ${packet.before.recruiter}/100.`,
          bandNote,
          '',
          jdMapBlock(packet.jdMap),
          packet.ceiling || '',
          'Say "tailor" to close the wording gap — facts stay exactly yours.',
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /* linkedin — headline and About, text only, from the evidenced ledger. */
    if (session.command === 'linkedin') {
      const source = session.resumeText.trim() || (session.shipped && session.shipped.text) || '';
      if (!source) return ask('resume', 'Attach or paste the resume the profile should be written from.');
      const led = atsEngine.factLedger(source);
      const role = session.target || (session.shipped && session.shipped.target) || 'your target role';
      const skills = led.evidencedSkills.slice(0, 2);
      const spike = [...led.roles.flatMap((r) => r.bullets), ...led.projects.flatMap((p) => p.bullets)].find((b) => /\d/.test(b));
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          'Command: linkedin',
          `Headline: ${role}${skills.length ? ' · ' + skills.join(' · ') : ''}`,
          '',
          'About:',
          `${role}. ${led.evidencedSkills.slice(0, 4).join(', ')}${led.evidencedSkills.length ? '.' : ''}`,
          spike ? String(spike).slice(0, 160) + '.' : '',
          'Open to roles where that work is the job.',
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /* recruiter — the 6-second scan, gate by gate. */
    if (session.command === 'recruiter') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume to run the recruiter view on.');
      const led = atsEngine.factLedger(session.resumeText);
      const scan = atsEngine.recruiterScan(session.resumeText, led, session.target);
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          'Command: recruiter',
          `Recruiter-scan: ${scan.total}/100 — what a human decides in six seconds.`,
          ...scan.gates.map((g) => `• ${g.gate}: ${g.points}/${g.of}`),
          'Proxy only. Not a live Workday/Greenhouse decision — Greenhouse does not auto-score resumes.',
        ].join('\n'),
        session,
      });
    }

    /* jobs — the router skill's handoff: hunting lives in the Job Portal. */
    if (session.command === 'jobs') {
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: 'Command: jobs\n\nJob hunting is the Job Portal agent\'s work: it reads your resume, fetches live postings from six boards, scores your fit per posting and writes the cold email to HR. Open /job-portal/ and upload the same resume there — this chat stays your resume workshop.',
        session,
      });
    }

    if (session.command === 'gap') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume to run the gap table on.');
      if (!session.jd) return ask('jd', 'Paste the job description — the gap table is measured against its wording.');
      const packet = atsEngine.rewriteResume(session.resumeText, { target: session.target, jd: session.jd });
      const kd = packet.detail.before.checker.keywordDetail || { matched: 0, terms: 0, overlap: 0, missing: [] };
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          `Gap table — ${kd.matched}/${kd.terms} JD terms evidenced (${kd.overlap}% overlap; the competitive band is 60–85%).`,
          '',
          jdMapBlock(packet.jdMap),
          '',
          packet.ceiling || 'Nothing on the Not-claimed list — the gap is wording, not facts. Say "tailor" and I will close it.',
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /*
     * compare — 2–5 JDs against one set of facts: a matrix and one
     * recommended target, as commands-and-open.md orders it. JDs arrive in a
     * single message separated by --- lines.
     */
    if (session.command === 'compare') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume first — the comparison is measured against your facts.');
      if (session.asked === 'jds' || /---/.test(msg)) {
        const jds = msg.split(/\n-{3,}\n?/).map((s) => s.trim()).filter((s) => s.length > 40).slice(0, 5);
        if (jds.length < 2) return ask('jds', 'I need at least two job descriptions, separated by a line containing only ---');
        const rows = jds.map((jd, i) => {
          const p = atsEngine.rewriteResume(session.resumeText, { target: session.target, jd });
          const kd = p.detail.before.checker.keywordDetail || { overlap: 0, matched: 0, terms: 0 };
          const title = (jd.match(/^[^\n.]{5,70}/) || [`JD ${i + 1}`])[0].trim();
          return { i: i + 1, title: title.slice(0, 50), overlap: kd.overlap, matched: kd.matched, terms: kd.terms, notClaimed: p.notClaimed.length };
        });
        rows.sort((a, b) => b.overlap - a.overlap);
        session.command = null;
        return res.json({
          ok: true, kind: 'help',
          reply: [
            'Fit matrix — evidenced keyword overlap per posting (competitive band 60–85%):',
            '',
            ...rows.map((r) => `${r.i}. ${r.title} — ${r.overlap}% (${r.matched}/${r.terms} terms, ${r.notClaimed} not claimed)`),
            '',
            `Strongest target: #${rows[0].i} (${rows[0].overlap}%). Say "tailor" with that JD and I will convert for it.`,
          ].join('\n'),
          session,
        });
      }
      return ask('jds', 'Paste 2–5 job descriptions in one message, separated by a line containing only ---');
    }

    /* cover — only after a resume shipped in this session, per the spec. */
    if (session.command === 'cover') {
      if (!session.shipped) {
        session.command = null;
        return res.json({ ok: true, kind: 'help', reply: 'A cover letter is written against a finished resume. Run check, build or tailor first — once a resume ships, say "cover letter" and I will write it from that exact document.', session });
      }
      /*
       * A letter needs more than a company name.
       *
       * This asked one question — "which company is the letter for?" — took
       * "amazon" for an answer and wrote the letter on that alone: no
       * position, no market, no project to point at, and a greeting reading
       * "Dear Hiring Team at for amazon". A letter is the most personal
       * artefact here and it was the least informed.
       *
       * So it interviews, one question per turn, each with the answers to
       * pick from where a known set exists. Nothing is required: skip any
       * question and the letter is written from what it has, minus whatever
       * that answer would have carried.
       */
      const led = atsEngine.factLedger(session.shipped.text);
      /*
       * The letter's own interview, from the shared bank.
       *
       * A letter states terms a resume does not — what the person wants to be
       * paid, how many hours they can give, which months they are free, how
       * long they can commit, how soon they can start. None of it was ever
       * asked, so every letter went out silent on the things a hiring manager
       * reads first. All of it is skippable; a term nobody states simply does
       * not appear.
       */
      const asked = askInterview('cover');
      if (asked) return asked;
      if (!session.details.coverproof && !(session.declined || []).includes('coverproof')) {
        return ask('coverproof', 'Last one: which piece of your work should the letter lead with? Name the project or the result, in your words — it goes in verbatim.');
      }

      const { coverLetter } = require('../../services/v2/jobMaterials');
      /* Their own answers first, the shipped resume second — never a guess. */
      const position = session.details.position || session.shipped.target || 'the advertised role';
      const place = [session.details.city, session.details.country].filter(Boolean).join(', ');
      const d = session.details;
      const letter = coverLetter(
        {
          name: led.name,
          role: position,
          skills: led.evidencedSkills,
          location: place || null,
          projects: [],
          link: d.link || d.github || d.linkedin || led.link || null,
          lead: d.coverproof || null,
          level: d.level || null,
          /* The terms they stated, each one optional. */
          workmode: d.workmode || null,
          hours: d.hours || null,
          window: d.window || null,
          availableFrom: d.availablefrom || null,
          commitLength: d.commitlength || null,
          notice: d.notice || null,
          salary: d.salary || null,
        },
        {
          title: position,
          company: session.details.company || 'your company',
          description: session.shipped.jd || '',
          tags: [],
          country: session.details.country || null,
        },
        session.shipped.text
      );
      session.command = null;
      return res.json({ ok: true, kind: 'help', reply: `Cover letter — ${letter.words} words${letter.withinLimit ? '' : ' (over the 300 limit — trim before sending)'}:\n\n${letter.text}`, session });
    }

    /* prep — the 5-line interview defense from the last shipped packet. */
    if (session.command === 'prep') {
      if (!session.lastPacket || !session.shipped) {
        session.command = null;
        return res.json({ ok: true, kind: 'help', reply: 'Interview prep works from a shipped resume. Run check, build or tailor first.', session });
      }
      const lp = session.lastPacket;
      const led = atsEngine.factLedger(session.shipped.text);
      const spike = led.roles.flatMap((r) => r.bullets).find((b) => /\d/.test(b)) || led.projects.flatMap((p) => p.bullets)[0] || 'your strongest project';
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          'Five-line defense — one answer per likely challenge:',
          `1. "Walk me through your strongest work" → ${String(spike).slice(0, 140)}`,
          `2. "Why this role" → it is the work your evidenced stack (${led.evidencedSkills.slice(0, 3).join(', ')}) already does.`,
          lp.notClaimed.length
            ? `3. "Do you know ${lp.notClaimed[0]}" → the honest line: not in production yet — say what you would learn it from, never claim it.`
            : '3. Every skill on the page has a bullet behind it — answer from the bullet, not from theory.',
          lp.dropped.length
            ? `4. If asked about ${String(lp.dropped[0]).slice(0, 30)} — it was dropped from the page for lack of evidence; do not resurrect it in the room.`
            : '4. Nothing on the page is unevidenced — there is no claim you cannot defend.',
          '5. Every number you say aloud must be one you can explain the measurement of. The resume contains no number you did not state yourself.',
        ].join('\n'),
        session,
      });
    }

    if (session.command === 'build') {
      /* Whatever they already gave us counts. Their own answers win over the
         resume's, so a correction typed in the chat is never overwritten. */
      if (session.resumeText.trim() && !session.seededFromResume) {
        session.details = { ...detailsFromResume(session.resumeText), ...session.details };
        session.seededFromResume = true;
      }
      /*
       * The stop rule used to cut the interview off after block 3, which was
       * safe only while the builder invented the rest: a page with no
       * education section still shipped a fabricated B.Tech. Now that nothing
       * is invented the section is simply absent, and the score drops over a
       * fact that was one question away. The remaining single-fact questions
       * are worth asking; the counter below is what keeps it from becoming an
       * interrogation.
       */
      const { iv, question } = nextQuestion(session);
      /*
       * "Build for google" is a person saying build it now, not an answer to
       * whatever was last asked. It was read as the build command instead, so
       * the pending question was thrown away and re-asked verbatim — the loop
       * a recording caught. Anything that reads as "just build it", with or
       * without a company after it, ships the draft.
       */
      /* A bare "build" is the command that starts the interview, so it must
         never force: only a build with an object after it ("build it",
         "build for google") is somebody saying ship what you have. */
      const forceBuild = /\b(build it|done|that'?s all|go ahead|finish|just build)\b/.test(low) ||
        /^\s*(?:ok(?:ay)?[, ]+)?(?:just |now |please )?build\s+(?:(?:it|this|one|the resume)\b|(?:for|at|to)\s+\S)/i.test(msg);
      /*
       * The full interview before a page is written.
       *
       * Build used to ask six things and start typing. It never asked where
       * somebody studied, whether their internship was paid, what they had
       * actually built, or what certifications they hold — then filled those
       * sections with a template, which is where the invented B.Tech came
       * from. The bank covers the whole page, one question per turn, every
       * one skippable, and the parts nobody answers are simply absent.
       */
      session.buildAsked = session.buildAsked || 0;
      /* The aim first — every keyword hangs off the target, so it is asked
         before anything else, exactly as the interview script orders it. */
      if (question && question.block === 1 && !forceBuild && session.buildAsked < 20) {
        session.buildAsked += 1;
        return ask(question.field, question.question);
      }
      /*
       * Their own repositories, read back to them.
       *
       * "Describe a project" is the question people freeze on — the work
       * exists, they just cannot summon it in a chat box. It is already
       * written down on GitHub, so once they give the handle the repos come
       * back as a list to pick from. Public API only, nothing a signed-out
       * visitor could not see, and nothing reaches the page until they choose
       * it: a description written at 2am is still a claim to defend in a room.
       */
      if (session.details.github && !session.githubImported && !session.details.projects) {
        session.githubImported = true;
        const gh = await githubImport.importProfile(session.details.github, { limit: 8 });
        if (gh.ok && gh.projects.length) {
          session.githubProjects = gh.projects.map((p) => p.bullet);
          if (gh.languages.length && !session.details.skills) {
            session.details.githubLanguages = gh.languages.join(', ');
          }
          session.asked = 'pickprojects';
          return res.json({
            ok: true, kind: 'ask',
            reply: [
              `Seat: RESUME · Command: build`,
              `I read ${gh.username}'s public GitHub — ${gh.publicRepos} repositories, ${gh.projects.length} that look like real projects rather than forks or scaffolds${gh.skipped ? ` (${gh.skipped} skipped)` : ''}.`,
              '',
              'Which of these should go on the resume? Pick one, or say "all", or skip and describe your own.',
            ].join('\n'),
            options: {
              multi: true,
              options: gh.projects.map((p) => ({
                label: p.name,
                note: [p.language, p.stars >= 5 ? `${p.stars}★` : null].filter(Boolean).join(' · '),
                value: p.bullet,
              })),
              other: { label: 'Something else — I will describe it', value: '' },
            },
            session,
          });
        }
      }

      if (!forceBuild && session.buildAsked < 20) {
        const asked = askInterview('build');
        if (asked) { session.buildAsked += 1; return asked; }
      }
      if (question && !forceBuild && !(iv.canBuild && question.block > 6) && session.buildAsked < 20) {
        session.buildAsked += 1;
        return ask(question.field, question.question);
      }
      /*
       * The stop rule stops.
       *
       * When the interview had nothing left to ask, this fell back to a
       * hard-coded skills question — with a fixed field, so a person who had
       * already declined skills was asked for them again, and again, and
       * again. It asked seven times in one walkthrough. A question that has
       * been declined is answered; if nothing is left to ask, the page gets
       * built out of whatever was given and the gaps are reported on it.
       */
      const declinedAll = session.declined || [];
      if (!iv.canBuild && !forceBuild && question && !declinedAll.includes(question.field)) {
        return ask(question.field, question.question);
      }
      const built = buildResume({ ...session.details, role: session.target || session.details.role });

      /*
       * Refuse to hand over a template.
       *
       * A recording ended with a downloaded PDF headed "YOUR NAME", carrying
       * "[ add your email and phone here ]" and a skills line the student had
       * never claimed. Building on empty answers produces a page that looks
       * finished and is not, so the missing fact is asked for instead — the
       * force words still ship it, because someone who says "build it anyway"
       * has been told and chosen.
       */
      /*
       * Asked once, then honoured.
       *
       * The guard re-asked for whatever was missing on every pass, so a
       * person who had already declined to give their name was asked for it
       * twelve times in one walkthrough — the loop, wearing the manners of a
       * safety check. A decline is an answer: the second time round the page
       * ships with the gap named on it rather than the question repeated.
       */
      const gaps = hasPlaceholders(built.text) ? missingEssentials(built.text) : [];
      const gapField = gaps.length
        ? (/name/.test(gaps[0]) ? 'name' : /email|phone/.test(gaps[0]) ? 'email' : 'skills')
        : null;
      if (gaps.length && !forceBuild && !(session.declined || []).includes(gapField)) {
        return ask(gapField,
          `I can lay the page out, but it would go out saying ${gaps[0]} is missing. What should it be? (Say "build it anyway" to take the draft as it stands.)`);
      }

      /*
       * "and make it 98/100" asked for a bar on this page, so the climb runs
       * on the page that was just built rather than being answered with a
       * ceiling about some earlier document.
       */
      if (session.raiseAfterBuild) {
        const goal = session.raiseAfterBuild;
        session.raiseAfterBuild = null;
        const out = raiseToTarget(built.text, session.target, session.jd, goal);
        session.command = 'build';
        return deliver(res, session,
          { text: out.text, report: out.report, missing: built.missing, potentialScore: out.report.score },
          out.reached
            ? `Checker ${out.report.score}/100 — every parse, heading, verb and keyword lever spent on the facts you gave. Nothing invented.`
            : `Checker ${out.report.score}/100. To reach ${goal} I need ${out.needFact ? out.needFact.ask : 'facts your answers do not yet contain'}. I will not invent it.`);
      }

      return deliver(res, session, built);
    }

    /*
     * No command, no pending question. The menu is shown once. A SECOND
     * unmatched message must not print it again — the same reply twice in a
     * row is the repeat bug in every one of its costumes — so the agent takes
     * the lead instead: with a resume in hand it starts the fix, without one
     * it asks for the resume or the interview.
     */
    if (session.menuShown) {
      session.menuShown = false;
      if (session.resumeText.trim()) {
        session.command = 'tailor';
        const q = nextQuestion(session).question;
        if (!session.target && !session.jd) return ask('target', 'Let me just fix it, then. What job title should the resume target? Say skip and I will convert without one.');
        if (q) { session.tailorAsked = (session.tailorAsked || 0) + 1; return ask(q.field, q.question); }
        const packet = atsEngine.rewriteResume(session.resumeText, { target: session.target, jd: session.jd, mode: 'CONVERT' });
        session.command = 'tailor';
        return deliver(res, session, packet);
      }
      session.command = 'check';
      return ask('resume', 'Let us start with the document: attach your resume (PDF or TXT) or paste its text — or say "build" and I will interview you from scratch.');
    }
    /* The ten-resume-agent skill's empty-state rule: one short line only.
       The four command bullets live in the UI's chips, not in the agent's
       mouth — echoing the interface copy back was the bug in the screenshot. */
    /*
     * With a resume in hand, this is a fact, not a lost visitor.
     *
     * Somebody who has just been handed a rewritten page and types "Jan 2022 –
     * Present" is answering the question about dates that was asked two turns
     * earlier. They were told "upload a resume or say the job title" — about
     * the document on the screen. Anything substantial said while a resume is
     * loaded goes onto that resume and the page is re-scored, which is the
     * only reading under which the sentence makes sense.
     */
    if (session.resumeText.trim() && msg.trim().length > 8) {
      session.resumeText += `\n\nExperience\n- ${msg.trim()}`;
      const rescored = scanResume(session.resumeText, session.target);
      session.lastScore = rescored.score;
      return res.json({
        ok: true,
        kind: 'scan',
        report: rescored,
        prompt: `Added to your experience, in your words. Checker ${rescored.score}/100. Say "make it 98" to spend the levers on it again, or keep giving me facts.`,
        session,
      });
    }

    session.menuShown = true;
    return res.json({
      ok: true, kind: 'help',
      reply: 'Upload a resume or say the job title.',
      session,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Something went wrong reading that. Paste the text instead and I will scan it.' });
  }
});

module.exports = router;
module.exports.scanResume = scanResume;
module.exports.raiseToTarget = raiseToTarget;
module.exports.buildResume = buildResume;
module.exports.resumePdfBuffer = resumePdfBuffer;
