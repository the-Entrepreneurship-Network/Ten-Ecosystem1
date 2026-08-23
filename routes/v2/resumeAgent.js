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
const aspirationalCompanies = require('../../services/v2/aspirationalCompanies');
const companyProfiles = require('../../services/v2/companyProfiles');
const career = require('../../services/v2/careerData');
const collegeData = require('../../services/v2/collegeData');
const interview = require('../../services/v2/resumeInterview');
const { httpFetch } = require('../../services/v2/httpFetch');
const githubImport = require('../../services/v2/githubImport');
const mockInterview = require('../../services/v2/mockInterview');
const parserView = require('../../services/v2/parserView');
const library = require('../../services/v2/resumeLibrary');
const skillPlan = require('../../services/v2/skillPlan');

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

/*
 * The page is scored as the page that exists.
 *
 * Planned work used to be cut out before scoring, on the reasoning that a
 * project you have not built should not earn you points. That is a fair
 * principle and it made the feature pointless: a student picked the projects
 * the agent recommended, watched them appear on their resume, and watched the
 * number not move — 75 before, 75 after. "What is the advantage of adding
 * those skills and projects if it is not increasing the score?" is the right
 * question and it has no good answer.
 *
 * An ATS scores the document it is given. These lines ARE on the document, so
 * they count — that is not a fiction, it is what the file says. The honesty
 * lives where it belongs and where it bites: every added line stays marked
 * [PLANNED — not built yet], the reply says plainly that it must be true
 * before the resume is sent, and the PDF refuses to export while a marker is
 * still there. The number describes the page; the marker and the gate keep
 * the page from being sent as a lie.
 *
 * The blanks are filled with representative values first, for the same reason
 * they were cut before: "<N> users at <N>ms" has no verb and no figure, so
 * counting it raw made picking projects LOWER the score, which is the exact
 * complaint in its first form. None of these substitutions ever reach the
 * page the student downloads.
 */
function resolvePlanned(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      if (/^PLANNED PROJECTS/i.test(line.trim())) return 'PROJECTS';
      if (/^LEARNING\b/i.test(line.trim())) return 'SKILLS';
      if (!/\[PLANNED/i.test(line)) return line;
      /* "Name — achievement" becomes the achievement, which is what a project
         bullet is; the name is already inside it. */
      const body = line.replace(/^-\s*/, '').replace(/\[PLANNED[^\]]*\]\s*/i, '');
      const dash = body.indexOf(' — ');
      return `- ${dash > 0 ? body.slice(dash + 3) : body}`;
    })
    .join('\n')
    .replace(/<N>/g, '12')
    .replace(/<before>/g, '1,400')
    .replace(/<after>/g, '380')
    .replace(/<[^>]{1,40}>/g, 'the service');
}

function scanResume(text, target, options) {
  const jdSupplied = Boolean(options && options.jd);
  const raw = resolvePlanned(text);
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
/*
 * Duty phrasing, rewritten into the verb that was already in the sentence.
 *
 * "Responsible for developing web applications" becomes "Developed web
 * applications" — same fact, stated as an achievement. The verb is taken from
 * the student's own words wherever the phrase contains one, so nothing new is
 * being claimed; where it does not, the replacement says only what the
 * original said. "Involved in team meetings" becomes "Contributed to team
 * meetings", never "Created team meetings" — they attended those meetings,
 * they did not convene them.
 */
const DUTY = [
  [/^responsible for\s+/i, 'Delivered '],
  [/^worked on\s+/i, 'Built '],
  [/^helped (?:with|to)\s+/i, 'Supported '],
  [/^involved in\s+/i, 'Contributed to '],
  [/^assisted (?:with|in)\s+/i, 'Supported '],
  [/^tasked with\s+/i, 'Delivered '],
  [/^duties included\s+/i, 'Delivered '],
];

/* -ing → -ed, so the verb the student already used survives the rewrite:
   "developing" becomes "Developed" rather than being buried behind one of
   ours. Irregulars are listed because a rule cannot reach them. */
const IRREGULAR = { building: 'Built', writing: 'Wrote', making: 'Made', leading: 'Led', running: 'Ran', taking: 'Took', doing: 'Did', teaching: 'Taught' };
function fromGerund(word) {
  const w = String(word || '').toLowerCase();
  if (!/ing$/.test(w) || w.length < 6) return '';
  if (IRREGULAR[w]) return IRREGULAR[w];
  const stem = w.slice(0, -3);
  /* "developping" is not a word; a doubled final consonant came from the
     -ing form and goes with it. */
  const undoubled = /([bdgklmnprt])\1$/.test(stem) ? stem.slice(0, -1) : stem;
  const base = /[^aeiou]e?$/.test(undoubled) && !/e$/.test(undoubled) ? undoubled : undoubled.replace(/e$/, '');
  return base.charAt(0).toUpperCase() + base.slice(1) + 'ed';
}

/*
 * Bullets open with an action verb where that can be done honestly, and are
 * left exactly as written where it cannot.
 *
 * The old rule was: if the first word is not in our verb list, put one in
 * front. Run over a real student resume it produced "Delivered participated
 * in Smart India Hackathon", "Built member of the coding club", "Developed
 * used HTML CSS JavaScript", "Created team meetings and daily standups" —
 * and, because education lines are lines too, "Delivered CGPA: 8.2". Nobody
 * would send that page. It also invented: attending a standup is not creating
 * one, and being a club member is not building anything.
 *
 * So a verb goes in front in exactly two cases. A recognised duty phrase,
 * which is rewritten into the verb it already contains. And a bare noun
 * phrase opening with an article — "A web portal for students" — where
 * "Built" says only what listing it under Projects already said. Everything
 * else is the student's sentence and stays theirs.
 */
function toBullet(text, i) {
  let t = String(text || '').trim().replace(/^([-*•]\s*)/, '');
  if (!t) return null;
  const words = t.split(/\s+/);
  const first = words[0].toLowerCase().replace(/[^a-z]/g, '');

  /* Already an achievement: our list, or any plain past-tense verb the
     student used that our list does not happen to name — participated,
     attended, presented, published. */
  const alreadyVerb = ACTION_VERBS.includes(first) ||
    (/ed$/.test(first) && first.length > 4 && !/^(need|advanced|based|related|combined|detailed|limited)$/.test(first));
  if (alreadyVerb) return t.charAt(0).toUpperCase() + t.slice(1).replace(/\.$/, '');

  const duty = DUTY.find(([re]) => re.test(t));
  if (duty) {
    const rest = t.replace(duty[0], '');
    /* The verb inside their own sentence wins over the one we would pick. */
    const own = fromGerund(rest.split(/\s+/)[0]);
    const body = own ? rest.split(/\s+/).slice(1).join(' ') : rest;
    const head = own || duty[1].trim();
    return `${head} ${body}`.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  }

  /*
   * A thing they made, described as a thing: "A web portal for students",
   * "JWT authentication service handling 1,200 logins a day", "Real-time chat
   * with Socket.io serving 120 concurrent users". Putting it under Projects
   * already says they built it, so "Built" adds no claim — it only moves the
   * claim to the front where a parser looks for it.
   *
   * Belonging to something is not building it. Member, volunteer, finalist,
   * captain — those open a statement of affiliation, and "Built member of the
   * coding club" is how the old rule read them.
   */
  const AFFILIATION = /^(member|participant|volunteer|winner|runner|finalist|president|secretary|treasurer|captain|organiser|organizer|attendee|delegate|fellow|scholar|recipient)\b/i;
  const artefact = /\b\d/.test(t) || /\w+ing\b/.test(t) || /^(a|an|the)\s+/i.test(t);
  if (!AFFILIATION.test(t) && artefact) {
    const body = t.replace(/^(a|an|the)\s+/i, '');
    const head = body.split(/\s+/)[0];
    /* "JWT" and "MongoDB" keep their own spelling; ordinary prose does not
       start a sentence mid-clause with a capital. */
    const isProper = /^[A-Z]{2,}$/.test(head) || /[A-Z]/.test(head.slice(1));
    return `Built ${isProper ? body : body.charAt(0).toLowerCase() + body.slice(1)}`.replace(/\.$/, '');
  }

  /* Anything else is left alone. A line that cannot be turned into an
     achievement without inventing one is not turned into an achievement. */
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/\.$/, '');
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

  /*
   * The same answer twice is one thing, not two.
   *
   * "Which projects have you built?" and the follow-up are both lists, and
   * picking the same entry in both is a click apart — so a page came back
   * with "Built API somebody else could use" printed twice under PROJECTS.
   * Duplicated lines are also the fastest way to look careless to the person
   * reading the resume, and they cost length for nothing.
   */
  const unique = (list) => {
    const seen = new Set();
    return list.filter((x) => {
      const k = String(x).trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const expItems = unique(splitLines(d.experience));
  const projItems = unique(splitLines(d.projects));
  /*
   * The degree, the college and the year make an education line even when
   * nobody assembled one.
   *
   * d.education is composed as those three answers arrive, so the interview
   * path was fine and every other caller was not: hand buildResume a degree,
   * a college and a graduation year directly and the page came back with no
   * EDUCATION section at all. A student's degree silently missing from their
   * own resume is not a failure mode worth leaving to one code path getting
   * it right.
   */
  const eduItems = splitLines(d.education).length
    ? splitLines(d.education)
    : [[d.degree, d.college, d.gradyear].filter(Boolean).join(', ')].filter(Boolean);

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
  /*
   * A .docx is a zip, and reading it as UTF-8 gives you the zip.
   *
   * The accept list said "PDF or TXT" while the code fell through to
   * `buffer.toString('utf8')` for everything else — so a student who
   * attached the Word file they actually keep their resume in had a few
   * kilobytes of binary scored as their career. Mammoth is already a
   * dependency of the docx export path.
   */
  if (name.endsWith('.docx')) {
    try {
      const mammoth = require('mammoth');
      const out = await mammoth.extractRawText({ buffer: file.buffer });
      return (out && out.value) || '';
    } catch (e) {
      return '';
    }
  }
  /* A .doc is the old binary format, which nothing here can read. Saying so
     beats scoring gibberish. */
  if (name.endsWith('.doc')) return '';
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

    /*
     * A planned project never leaves as a PDF.
     *
     * The planned section exists so somebody can see the page they are
     * working towards. A downloaded file is the one artefact nobody reviews
     * again before attaching it to an application, so this is the boundary:
     * the draft may say "not built yet", the export may not exist at all
     * while it does. Either they say the work is done and give the numbers,
     * or the section comes off and the honest page downloads.
     */
    /* Everything this route could be building from, not just one field: the
       browser sends details, a script might send text, and a planned line
       must not slip through whichever door it arrives at. */
    const planned = skillPlan.plannedLines(
      [b.text, built.text, b.projects, b.experience, JSON.stringify(b.details || '')].filter(Boolean).join('\n'),
    );
    if (planned.length) {
      return res.status(400).json({
        ok: false,
        error: `This page still carries ${planned.length} project you have not built yet. It will not export while it does — a project you cannot walk through fails the first question an interviewer asks about it. Say "I built it" and give me the real numbers, or say "apply with what I have" and I will take the planned section off.`,
        planned,
      });
    }

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
    /*
     * Education and certifications are credentials, not achievements.
     *
     * The lever walked every line beginning with a dash, and a degree written
     * as a bullet is such a line — so a real resume came back saying
     * "Delivered CGPA: 8.2" and "Developed kalinga Institute of Industrial
     * Technology". A qualification is a fact somebody holds; there is no verb
     * that belongs in front of it.
     */
    const CREDENTIAL = /^(education|academics?|qualifications?|certifications?|courses?|awards?|achievements?|honou?rs)\b/i;
    let inCredential = false;
    const relined = best.split('\n').map((line, i) => {
      if (isHeading(line)) inCredential = CREDENTIAL.test(line.trim());
      if (inCredential || !/^-\s+/.test(line)) return line;
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
/**
 * The role named in a hunt request.
 *
 * "find me jobs for a backend engineer", "any openings as a data analyst",
 * "internships for a frontend developer". targetFromSentence only reads
 * sentences built around the word resume, so a request for jobs carrying its
 * own title fell through and was answered with "attach your resume first".
 */
function roleFromHunt(low) {
  const m = String(low).match(
    /\b(?:jobs?|openings?|roles?|positions?|internships?|vacanc(?:y|ies))\s+(?:for|as|in)\s+(?:an?\s+|the\s+)?([a-z][a-z0-9+#./ -]{2,40}?)(?=\s+(?:and|with|that|which|to|so|please|near|in|at|remote)\b|[,.]|$)/);
  if (!m) return '';
  return m[1].trim().replace(/\s+/g, ' ');
}

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
  /* "Show me the openings" is what the build offers at the end of a page, and
     it used to route nowhere — the agent suggested a phrase it did not know. */
  if (/\bfind (me )?jobs?\b|\bjob hunt\b|\bhunt for jobs\b|\bemail (the )?hr\b|\bapply to jobs\b|\bshow (me )?(the )?(openings|jobs|roles|listings)\b|\bwho(?:'s| is) hiring\b|\bopenings\b/.test(low)) return 'jobs';
  /* "Write the letter" is what a person says when the agent has just offered
     one, and it used to route to a resume rebuild — the offer suggested a
     phrase the router did not recognise. */
  if (/\bcover letter\b|\bcover\b.*\b(letter|note)\b|\bwrite (the|a|me a) letter\b|\byes,? write it\b/.test(low)) return 'cover';
  if (/\bcompare\b|which (job|jd|posting)|between these (jobs|jds)/.test(low)) return 'compare';
  /* The Rezi-parity commands, ahead of the looser matchers below so that
     "score" reaches the five bars rather than the single number. */
  if (/\bmock interview\b|\bai interview\b|\binterview me\b|\bpractice interview\b|\bstart (the )?interview\b/.test(low)) return 'interview';
  if (/\breview (my )?interview\b|\binterview review\b|\bmy transcript\b/.test(low)) return 'interview-review';
  if (/\bscore5\b|\bfive bars?\b|\bbreak ?down (my )?score\b|\bdetailed score\b|\bscore breakdown\b/.test(low)) return 'score5';
  if (/\bwhat (does|will) (the |an )?ats (see|read|extract)\b|\bparser view\b|\bparse (my )?resume\b|\bextraction\b/.test(low)) return 'parser';
  if (/\bquick check\b|\broast\b|\bten.second\b|\bfirst impression\b/.test(low)) return 'quickcheck';
  if (/\blist (my )?(resumes?|versions?)\b|\bmy versions?\b|\bsaved resumes?\b/.test(low)) return 'versions';
  if (/\bbest bullets?\b|\bmy bullets?\b|\bbullet library\b|\brelevant bullets?\b/.test(low)) return 'bullets';
  if (/\bmissing keywords?\b|\bkeyword (table|gap|check)\b|\bwhich keywords?\b/.test(low)) return 'keywords';
  if (/\b(how (do|can) i (get|learn|gain)|skill plan|gap plan|what should i build|how to (get|learn|gain) (these|those)|close the gap)\b/.test(low)) return 'plan';
  if (/\b(add (the|these|those) projects?|put (them|these) on|add them to my resume|plan (them|these) onto)\b/.test(low)) return 'plan-add';
  if (/\b(i built (it|them|these)|i(?:'ve| have) (built|done|finished) (it|them|these)|mark (it|them) (built|done)|they are built)\b/.test(low)) return 'plan-built';
  if (/\b(remove (the )?planned|drop (the )?planned|apply (now|with what i have)|take (them|those) off)\b/.test(low)) return 'plan-remove';
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
  /*
   * "Tailor this and make it 98 for the Google backend engineer role" is a
   * tailor, not a raise.
   *
   * A score anywhere in the sentence claimed the turn, so a student who named
   * the action, the company, the role AND the level in one line was answered
   * with the ceiling speech about needing a metric — every one of those four
   * facts discarded. A number is a quality bar on the thing being asked for;
   * it is never the thing itself. Where the sentence also says tailor, or
   * names an employer to aim at, the tailor wins and the number becomes its
   * goal.
   */
  if (SCORE_INTENT.test(low) &&
      !/\btailor\b/.test(low) &&
      !/\bfor (?:the )?[a-z0-9][\w.& -]{2,40}\b(?:role|position|job|opening)\b/.test(low) &&
      !/\bfor [a-z0-9][\w.&-]{2,30}\b(?:'s)?\s+(?:[a-z]+\s+){0,3}(?:engineer|developer|analyst|scientist|designer|manager|intern)\b/.test(low)) {
    return 'raise';
  }
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
  /*
   * The score, and that is the whole header.
   *
   * It used to open with the band, then the score, then the match percentage,
   * then a four-part component breakdown, then a factual ceiling, then the
   * proxy caveat — six lines of measurement above a resume somebody wanted to
   * read. The brief is the resume, the score, and what to do next. The band,
   * the components and the match line are all still computed and still on the
   * packet; ask for the breakdown and it is one command away.
   */
  if (packet) return `ATS score: ${scanResume(packet.resume, packet.target || '').score}/100`;
  /* A scan with no rewrite behind it still says which band the page is in,
     because that is the answer to the question that was asked. */
  return [
    `Band: ${band}`,
    'Proxy only. Not a live Workday/Greenhouse decision — Greenhouse does not auto-score resumes.',
  ].join('\n');
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

  /*
   * Three questions are typed, and the rest are picked.
   *
   * Name, email and phone are the only answers nobody can offer a list for —
   * they are the person, and there is no set to choose from. Everything else
   * about a resume comes from a known set: degrees, graduation years,
   * employers, stipend bands, availability, hours. Typing them was the whole
   * reason people abandoned the interview, and a typed answer is also the one
   * the parser most often gets wrong.
   *
   * Every list below ends with the free-text escape, so a degree, an employer
   * or a college nobody thought of is always one click and one line away.
   */
  const YEARS = (back, forward) => {
    const y = new Date().getFullYear();
    const out = [];
    for (let i = -forward; i <= back; i += 1) out.push({ label: String(y - i), value: String(y - i) });
    return out;
  };

  if (field === 'degree') {
    return {
      multi: false,
      groups: [
        { group: 'Undergraduate', options: ['B.Tech Computer Science', 'B.Tech Information Technology', 'B.Tech Electronics and Communication', 'B.Tech Electrical', 'B.Tech Mechanical', 'B.Tech Civil', 'B.E Computer Science', 'BCA', 'B.Sc Computer Science', 'B.Sc Information Technology', 'B.Com', 'BBA', 'B.Des'].map((v) => ({ label: v, value: v })) },
        { group: 'Postgraduate', options: ['M.Tech Computer Science', 'M.E Computer Science', 'MCA', 'M.Sc Computer Science', 'MBA', 'M.Des', 'PhD'].map((v) => ({ label: v, value: v })) },
        { group: 'Diploma and other', options: ['Diploma in Engineering', 'Polytechnic Diploma', 'Class XII (PCM)', 'Class XII (Commerce)'].map((v) => ({ label: v, value: v })) },
      ],
      other,
    };
  }

  /*
   * Which skills, and which projects, picked from the ones the target role
   * is built on rather than typed into an empty box.
   *
   * These were the last two essay questions in the interview and they were
   * the two people gave up on: "list your skills" and "describe your
   * projects" are the exact prompts somebody came to this tool to avoid
   * writing. The list is what the role they just chose actually runs on, so
   * it doubles as a reminder — people forget half of what they have done.
   *
   * Multi-select, because nobody has exactly one. Nothing is ticked for
   * them, so nothing lands on the page that they did not claim.
   */
  if (field === 'skills') {
    const bank = roleBank(session.target || (session.details || {}).role || '');
    const deep = skillPlan.DEEP_BENCH;
    const family = /data|analyt/i.test(session.target || '') ? deep.data
      : /front.?end|ui|ux|design/i.test(session.target || '') ? deep.frontend
        : /devops|cloud|sre|platform|infra/i.test(session.target || '') ? deep.devops
          : /security|cyber/i.test(session.target || '') ? deep.security
            : /\bml\b|machine learning|\bai\b/i.test(session.target || '') ? deep.ml
              : deep.software;
    const seen = new Set();
    const dedupe = (list) => list.filter((s) => {
      const k = String(s).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((s) => ({ label: s, value: s }));
    return {
      multi: true,
      groups: [
        { group: `Core for ${bank.key}`, options: dedupe(bank.words) },
        { group: 'Also worth listing if you have used them', options: dedupe(family).slice(0, 24) },
      ],
      other,
    };
  }

  if (field === 'projects' || field === 'projects2' || field === 'pickprojects') {
    const built = skillPlan.catalogueFor(session.target || (session.details || {}).role || '', [], 20);
    return {
      multi: true,
      options: built.map((p) => ({ label: p.build, note: p.term, value: p.build })),
      other: { label: 'Something else — I will describe it', value: '' },
    };
  }

  /* Yes or no is a list of two, and it was the last thing in the flow still
     waiting for somebody to type a word. */
  if (field === 'confirmtailor') {
    return {
      multi: false,
      options: [
        { label: 'Yes — tailor it for this role', value: 'yes' },
        { label: 'No — leave my resume as it is', value: 'no' },
      ],
    };
  }

  if (field === 'college') {
    return {
      multi: false,
      groups: collegeData.COLLEGE_GROUPS.map((g) => ({
        group: g.group,
        options: g.colleges.map((c) => ({ label: c, value: c })),
      })),
      other,
    };
  }

  if (field === 'gradyear') {
    /* Graduating students pick a year that has not happened yet, which is why
       the list runs forward as well as back. */
    return { multi: false, options: YEARS(8, 4), other };
  }

  if (field === 'hasinternship' || field === 'hasprojects') {
    const thing = field === 'hasinternship' ? 'internship or job' : 'project';
    return {
      multi: false,
      options: [
        { label: `Yes — one ${thing}`, value: 'yes' },
        { label: `Yes — two or more`, value: 'yes, several' },
        { label: `Not yet`, value: 'no' },
      ],
      other,
    };
  }

  if (field === 'stipend') {
    return {
      multi: false,
      options: ['Unpaid', 'Under ₹5,000 a month', '₹5,000 – ₹10,000 a month',
        '₹10,000 – ₹25,000 a month', '₹25,000 – ₹50,000 a month', 'Over ₹50,000 a month',
        'Would rather not say'].map((v) => ({ label: v, value: v })),
      other,
    };
  }

  if (field === 'availablefrom') {
    const now = new Date();
    const months = [];
    for (let i = 0; i < 6; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const label = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
      months.push({ label: i === 0 ? `${label} — immediately` : label, value: label });
    }
    return { multi: false, options: months, other };
  }

  if (field === 'hours') {
    return {
      multi: false,
      options: ['Full time', 'Part time — up to 20 hours a week',
        'Part time — up to 10 hours a week', 'Weekends only', 'Flexible'].map((v) => ({ label: v, value: v })),
      other,
    };
  }

  if (field === 'commitlength') {
    return {
      multi: false,
      options: ['1 month', '2 months', '3 months', '6 months', '1 year', 'Ongoing'].map((v) => ({ label: v, value: v })),
      other,
    };
  }

  if (field === 'workmode') {
    return {
      multi: false,
      options: ['On site', 'Hybrid', 'Fully remote', 'No preference'].map((v) => ({ label: v, value: v })),
      other,
    };
  }

  /*
   * Where they interned, from the employer list rather than a blank box.
   *
   * The list is the large employers plus whoever the market data says
   * recruits where they are, so most students find themselves on it. Anybody
   * who does not takes the escape and types the name — which is the one place
   * a company name should ever have to be typed.
   */
  if (field === 'internship' || field === 'internship2' || field === 'internship3') {
    const local = d.city ? career.companiesHiringIn(d.city) : [];
    const seen = new Set();
    const pick = (list) => list.filter((n) => {
      const k = String(n).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((n) => ({ label: n, value: n }));
    const groups = [];
    if (local.length) groups.push({ group: `Hiring in ${d.city}`, options: pick(local).slice(0, 18) });
    groups.push({
      group: 'Large employers',
      options: pick(aspirationalCompanies.COMPANIES.map(([n]) => n)).slice(0, 40),
    });
    groups.push({
      group: 'Startups and everyone else',
      options: [{ label: 'A startup', value: 'a startup' },
        { label: 'A college or research lab', value: 'a college lab' },
        { label: 'Freelance / self-employed', value: 'freelance' }],
    });
    return { multi: false, groups, other };
  }

  /* Internship dates are role dates by another name. */
  if (field === 'internshipdates') return optionsFor('roledates', session);

  /*
   * When did you do it — asked as a list, because it is a fact with a small
   * number of plausible answers.
   *
   * A resume with no date on any role loses ten points outright, and it is
   * the single largest thing standing between a real student page and the
   * ninety this is supposed to reach. It cannot be inferred and must not be
   * invented; they know it, and picking a range takes a second.
   */
  if (field === 'roledates') {
    const y = new Date().getFullYear();
    const spans = [];
    for (let i = 0; i < 4; i += 1) {
      spans.push({ label: `${y - i - 1} – ${i === 0 ? 'Present' : y - i}`, value: `${y - i - 1} - ${i === 0 ? 'Present' : y - i}` });
    }
    /* Internships are months, not years, so the common shapes are offered
       too rather than forcing a whole year onto a six-week placement. */
    ['Jan', 'Mar', 'May', 'Jun', 'Jul', 'Sep'].forEach((m, k) => {
      const end = ['Mar', 'May', 'Jul', 'Aug', 'Nov', 'Dec'][k];
      spans.push({ label: `${m} ${y - 1} – ${end} ${y - 1}`, value: `${m} ${y - 1} - ${end} ${y - 1}` });
    });
    return { multi: false, options: spans, other };
  }

  /* The job search asks the same question the resume does, and deserves the
     same list — a person browsing openings is picking a known title. */
  if (field === 'target' || field === 'position' || field === 'jobrole') {
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
    /*
     * A heading is a heading and a bullet is a bullet.
     *
     * Every line of the experience block was mapped to a role whose single
     * bullet was that line — so "Google | 2025 - Present" became an
     * achievement, and a page listing three internships came back claiming
     * "- Google" three times. Lines that carry an employer and dates open a
     * role; lines marked as bullets belong to the role above them.
     */
    roles: items(d.experience).reduce((acc, line) => {
      const t = String(line).trim();
      if (/^[-*•]/.test(t)) {
        const bullet = t.replace(/^[-*•]\s*/, '');
        if (acc.length) acc[acc.length - 1].bullets.push(bullet);
        else acc.push({ header: '', hasDates: false, bullets: [bullet] });
        return acc;
      }
      acc.push({ header: t, hasDates: /\d{4}/.test(t), bullets: [] });
      return acc;
    }, []),
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
  /*
   * Where they worked is a heading. It is not an achievement.
   *
   * The question became a list of employers, so the answer is now a company
   * name rather than a paragraph — and the old assembly put the second and
   * third internships in as loose lines under the first, where the ledger
   * read them as bullets. A page came back with an EXPERIENCE section whose
   * achievements were "- Google" and "- Google". Nobody claimed to have done
   * Google.
   *
   * Each internship gets its own dated header, and anything the student
   * actually typed past the company name stays as the work beneath it.
   */
  const paid = d.stipend && !/^unpaid$/i.test(d.stipend) ? ' (paid internship)' : '';
  const one = (answer, dates, first) => {
    const text = String(answer || '').trim();
    if (!text) return [];
    /* A typed answer may carry the work after the employer — "Zeta Labs.
       Built the reporting service" — and that half is a bullet. */
    const cut = text.search(/[.\n]/);
    const employer = cut > 0 ? text.slice(0, cut).trim() : text;
    const work = cut > 0 ? text.slice(cut + 1).trim() : '';
    /*
     * Always a pipe, so the line reads as a header rather than a claim.
     *
     * A header is recognised by its dates or its separator, and the second
     * and third internships are never asked for dates — so "Google" arrived
     * looking like prose and was verb-fronted into "- Built Google". The role
     * word is what the student picked the employer for, and it is true of any
     * internship, so it carries the line and the parser gets its separator.
     */
    const role = d.role || 'Intern';
    const header = [employer, dates || role].filter(Boolean).join(' | ');
    return [header + (first ? paid : ''), ...(work ? [`- ${work}`] : [])];
  };

  d.experience = [
    ...one(d.internship, d.internshipdates, true),
    ...one(d.internship2, ''),
    ...one(d.internship3, ''),
  ].filter(Boolean).join('\n');
}

/** Where each interview answer lands. */
function consumeAnswer(session, field, msg) {
  /*
   * One answer to a one-answer question.
   *
   * "How many hours a week can you commit?" takes one option, and a comma-
   * joined reply to it went into the letter whole: "Able to commit up to 10
   * hours a week, 10-20 hours a week, 20-30 hours a week, 40 hours a week."
   * The question is single-select, so the first option it names is the
   * answer — the rest is noise from a client, a paste or a retry, and it
   * belongs nowhere near a letter somebody sends.
   */
  const single = interview.optionsFor
    ? interview.optionsFor(interview.entryFor && interview.entryFor(field), session.details)
    : null;
  if (single && single.multi === false && Array.isArray(single.options) && /,/.test(msg)) {
    const values = single.options.map((o) => String(o.value)).filter(Boolean);
    const first = msg.split(',').map((s) => s.trim())
      .find((part) => values.some((v) => v.toLowerCase() === part.toLowerCase()));
    if (first) msg = first;
  }
  const skip = /^(skip|no|none|nothing|na|n\/a|not now)\.?$/i.test(msg.trim());
  /* A declined question is settled, not pending. Without this, "skip" left
     the fact absent, the ledger regenerated the same question, and the agent
     asked it again every turn — the exact repeat-loop this rewrite removes. */
  if (skip) {
    session.declined = session.declined || [];
    if (!session.declined.includes(field)) session.declined.push(field);
    return;
  }
  /*
   * An interview answer belongs to the interview, not to the details bag.
   *
   * It was landing in `session.details.answer` — overwritten by the next
   * one — while the interview's own array stayed empty, so every answer read
   * as unanswered and the same question came back with "your last message did
   * not read as an answer to it".
   */
  /*
   * A planned project becomes a real one, in their words.
   *
   * The planned line is removed and their sentence goes into the actual
   * Projects section — so the only route from "planned" to "on the resume"
   * runs through the student stating what the finished thing did.
   */
  if (field === 'builtproof') {
    const skillPlanMod = require('../../services/v2/skillPlan');
    const said = msg.trim();
    const lines = String(session.resumeText || '').split('\n');
    /* The planned entry this answer is about — matched on the words they
       used, so "the Kafka one" finds the Kafka row. */
    const words = said.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    let hit = -1;
    lines.forEach((l, i) => {
      if (hit !== -1 || !skillPlanMod.RE_PLANNED.test(l)) return;
      if (words.some((w) => l.toLowerCase().includes(w))) hit = i;
    });
    if (hit === -1) hit = lines.findIndex((l) => skillPlanMod.RE_PLANNED.test(l));
    if (hit !== -1) lines.splice(hit, 1);

    let text = lines.join('\n');
    const projAt = text.split('\n').findIndex((l) => /^PROJECTS\b/i.test(l.trim()));
    const rows = text.split('\n');
    if (projAt === -1) {
      const eduAt = rows.findIndex((l) => /^EDUCATION\b/i.test(l.trim()));
      const block = ['', 'PROJECTS', `- ${said}`];
      text = eduAt === -1 ? [...rows, ...block].join('\n') : [...rows.slice(0, eduAt), ...block, '', ...rows.slice(eduAt)].join('\n');
    } else {
      rows.splice(projAt + 1, 0, `- ${said}`);
      text = rows.join('\n');
    }
    /* An empty planned heading is tidied away rather than left as a stub. */
    session.resumeText = /\[PLANNED/i.test(text) ? text : skillPlanMod.withoutPlanned(text);
    session.plannedCount = skillPlanMod.plannedLines(session.resumeText).length;
    return;
  }

  if (field === 'answer' && session.interview) {
    const iv = session.interview;
    iv.answers.push({ question: iv.questions[iv.at], transcript: msg.trim() });
    iv.at += 1;
    return;
  }
  /* The role to search openings for — kept apart from the resume's target,
     because looking at data roles does not retitle the page you already have. */
  /*
   * The dates go onto the role header that has none.
   *
   * Written into the line the parser reads for them, not appended somewhere
   * decorative — the check counts parseable ranges next to a role.
   */
  if (field === 'roledates') {
    const span = msg.trim();
    session.declined = session.declined || [];
    if (!span || /^skip$/i.test(span)) {
      if (!session.declined.includes('roledates')) session.declined.push('roledates');
      return;
    }
    /*
     * Skip past a role that already has dates. Do not stop at it.
     *
     * The walk gave up the moment it saw any date range, so a page with two
     * roles — one dated, one not — kept the undated one undated however many
     * times this was answered, and sat at 5/10 for a check the student had
     * just supplied the missing half of. It is the first role WITHOUT dates
     * that the answer belongs to, wherever it sits.
     *
     * One role per answer, deliberately: the same span pasted onto every
     * undated role would be inventing dates for jobs nobody asked about. If
     * another role is still bare the question comes back for that one, and
     * skipping ends it.
     */
    let done = false;
    session.resumeText = String(session.resumeText || '').split('\n').map((line) => {
      if (done || !line.trim()) return line;
      if (isHeading(line) || /^[-*•]/.test(line.trim())) return line;
      if (RE_DATE_RANGE.test(line)) return line;
      /* The first role-shaped line without a date on it. */
      if (/\|/.test(line) || RE_JOB_TITLE_LINE.test(line)) {
        done = true;
        return `${line.replace(/[\s,|]+$/, '')} | ${span}`;
      }
      return line;
    }).join('\n');
    session.details.roleDates = span;
    return;
  }

  if (field === 'jobrole') {
    /*
     * A sentence is not a job title.
     *
     * Typed rather than picked, the answer arrives as whatever they wrote —
     * and "find me jobs for a backend engineer" became the role, so thirty
     * target rows came back titled "find me jobs for a backend engineer at
     * Verizon". The title inside the sentence is the answer; the sentence is
     * only how they said it.
     */
    const raw = msg.trim();
    session.jobRole = roleFromHunt(raw.toLowerCase()) || targetFromSentence(raw.toLowerCase()) || raw;
    return;
  }

  /*
   * The answer to "should I tailor for this?".
   *
   * Consumed here, where every other answer is consumed, so the pending
   * posting is cleared before the router runs again — leaving it set made
   * the confirmation re-ask itself on the yes that was meant to end it.
   */
  if (field === 'confirmtailor') {
    const job = session.pendingTailor;
    session.pendingTailor = null;
    session.tailorConfirmed = /\b(yes|yeah|yep|sure|ok|okay|go|do it|please|tailor)\b/i.test(msg);
    if (session.tailorConfirmed && job) session.pickedJob = job;
    return;
  }

  /* Their pick of what to lead with. Both are lines already on the page, so
     recording one can never introduce a claim. */
  /*
   * A pick keeps the command running.
   *
   * Answering "which work should lead?" cleared the pending question and left
   * no command, so the next turn fell through to the catch-all and filed the
   * answer as a new line of experience — the student picked two of their own
   * bullets and the agent added them to the resume a second time.
   */
  if (field === 'leadproject') {
    session.details.leadProject = msg.trim();
    session.command = session.command || 'tailor';
    return;
  }
  if (field === 'leadskill') {
    session.details.leadSkill = msg.trim();
    session.command = session.command || 'tailor';
    return;
  }

  /*
   * The project they chose to build next.
   *
   * It goes on the page under its own heading, marked as planned, with the
   * numbers blank — and the export refuses while it is there. So the student
   * can see the resume they are working towards without ever being able to
   * send one that claims work they have not done.
   */
  if (field === 'addproject') {
    const plan = session.planCache;
    const low = String(msg).toLowerCase();
    /* Several at once: one project rarely closes a gap, and somebody
       planning a month of work should be able to plan all of it. */
    const chosen = plan && plan.ok
      ? plan.plans.filter((p) => low.includes(String(p.term).toLowerCase()) || low.includes(String(p.build).toLowerCase()))
      : [];
    if (chosen.length) {
      session.resumeText = skillPlan.withPlannedProjects(
        session.resumeText, skillPlan.projectEntries({ ok: true, plans: chosen }));
      session.details.addProject = chosen.map((c) => c.term).join(', ');
      session.plannedGuide = chosen[0];
      session.plannedGuides = chosen;
    } else {
      /*
       * Declining is an answer.
       *
       * Without recording it the question came back on the next pass, which
       * is the repeat-loop this whole design exists to prevent — and it also
       * blocked the fact questions behind it, so a student who wanted to give
       * a real number never got asked for one.
       */
      session.declined = session.declined || [];
      if (!session.declined.includes('addproject')) session.declined.push('addproject');
    }
    session.planCache = null;
    session.command = session.command || (session.pendingRaise ? 'raise' : 'tailor');
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
    /* Picked from the list it arrives correct; typed through the escape,
       "kiit bbsr" and "IIT-M" become the name the institution itself uses,
       which is the string a recruiter searches and a filter matches. */
    d[field] = field === 'college'
      ? (collegeData.matchCollege(msg) || msg.trim())
      : msg.trim();
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
    /* And recorded under its own name, so the question knows it was answered.
       These are derived from the ledger, and an answer that does not change
       the ledger left the question asking itself forever. */
    d[field] = msg.trim();
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
  /*
   * Declined questions stay answered — "skip" is an answer. So do answered
   * ones, which sounds obvious and was not true.
   *
   * The engine derives its questions from the ledger, so a question whose
   * answer does not change the ledger comes back forever: "one real number
   * for your strongest bullet" is asked when no bullet carries a number, and
   * typing the number does not put it in a bullet, so it was asked again on
   * the next turn, and the next. One walk-through collected seventeen of
   * them. Anything already sitting in details has been answered, whatever it
   * did or did not do to the page.
   */
  const declined = session.declined || [];
  const answered = Object.keys(d).filter((k) => String(d[k] || '').trim());
  const open = iv.questions.filter((q) =>
    !declined.includes(q.field) && !answered.includes(q.field));
  return { iv, question: open[0] || null };
}

/**
 * The openings, from the Job Portal's own search.
 *
 * The two seats were each running their own hunt, so a student read a role
 * here, tailored for it, walked to the portal — and it was not in the list.
 * Two pipelines over the same boards cannot be kept in step by care; they
 * drift the moment either is touched, which is exactly what happened.
 *
 * So there is one hunt. This calls the portal's `/search` endpoint in
 * process, with the parameters its own UI sends, and shows what comes back in
 * the order it comes back. Nothing in the job agent is changed or
 * reimplemented — sources, ranking, fit, link resolution and the direct-only
 * rule all stay exactly where they are, and whatever the portal will list is
 * what appears here.
 *
 * The difference between the seats is presentation, not content: the portal
 * hands over a link to apply through, and this shows the role to tailor for.
 */
async function portalJobs(resumeText, role) {
  /*
   * Called directly, not over a loopback HTTP request to ourselves.
   *
   * This used to POST to http://127.0.0.1:${PORT}/api/v2/jobs/search — a
   * network round trip to reach a function in the same module graph, and one
   * that only works if PORT happens to name the socket the server is actually
   * listening on. Behind the hosting proxy in production it does not: the
   * process is reached on a different port, or a pipe, or IPv6 loopback, so
   * the request was refused and the board came back empty every time. The
   * search on screen had nothing wrong with it; the seat could not reach it.
   *
   * findJobs IS the endpoint's body — same boards, same dedupe, same ranking,
   * same order — so parity with the Job Portal is unchanged and there is no
   * longer anything to misconfigure. Required here rather than at the top of
   * the file because the two routers reference each other.
   */
  // eslint-disable-next-line global-require
  const jobAgent = require('./jobAgent');
  const jobs = await jobAgent.findJobs(String(resumeText || ''), { role: String(role || '') });
  if (!Array.isArray(jobs)) throw new Error('job search returned nothing usable');

  /* Read, never re-sorted: the order IS the parity. */
  return jobs.slice(0, 8).map((j) => ({
    title: String(j.title || '').slice(0, 120),
    company: String(j.company || '').slice(0, 60),
    location: String(j.location || '').slice(0, 60),
    /* Carried so a tailor can read the posting, and so the row can be matched
       to the portal's — but never rendered as a link in this seat. */
    url: String(j.directUrl || j.url || ''),
    description: String(j.description || '').slice(0, 4000),
    tags: Array.isArray(j.tags) ? j.tags.slice(0, 12) : [],
    posted: j.posted || null,
    type: String(j.type || '').slice(0, 40) || null,
    salary: String(j.salary || '').slice(0, 60) || null,
    fit: j.fit5 || null,
    snippet: String(j.description || '').split('\n').find((l) => l.length > 40) || '',
  }));
}

/**
 * What the page will score once the planned work exists.
 *
 * A planned project carries blanks where its numbers will go, so the page it
 * sits on scores as if those bullets had no figures — which is true today and
 * useless as an answer to "will this get me to 98?". The projected score
 * reads the same page with the blanks filled, and is always reported beside
 * the real one rather than instead of it: today's number is what an ATS sees
 * today, and the projection is what the month of work buys.
 *
 * It is a projection, not a promise, and it is labelled as one everywhere it
 * appears.
 */
/*
 * Kept as a name, now that the score itself counts the planned work.
 *
 * There were two numbers — today's and what-it-will-be — and they had to be
 * explained side by side every time. There is one now, because the page has
 * one. Callers that ask for the projection get the score, which is the same
 * thing they were always trying to show.
 */
function projectedScore(text, target) {
  return scanResume(text, target).score;
}

/**
 * Climb to the number they asked for by adding work, not by inventing facts.
 *
 * "Make it 96" used to end in a ceiling sentence: here is 89, the rest needs
 * facts your history does not show, I will not invent them. Every word of that
 * is true and it is still a refusal — the student asked how to get to 96 and
 * was told no. There is an honest answer, and it is the one a good mentor
 * gives: here is exactly what to build, in order, and here is the page it
 * produces once you have.
 *
 * So the planned projects and the learning skills go on until the projection
 * clears the goal. Nothing is claimed — every line stays marked planned, stays
 * blanked, and the PDF gate still refuses to export while any of it is there.
 * The number reported is what the page scores WHEN THE WORK EXISTS, said in
 * those words, next to today's number.
 *
 * Returns the page, both numbers, and the plans actually used, so the caller
 * can print the build order.
 */
function climbToGoal(text, target, goal, plans, picked = [], houseSkills = [], onPage = 12, stale = 3) {
  const want = Math.min(100, Math.max(1, goal || 98));
  /* Their picks first, in the order they picked them — a student who chose
     Kafka is owed Kafka on the page, whether or not it was the cheapest
     point. The rest of the catalogue follows as top-up. */
  const byTerm = new Map(plans.map((p) => [String(p.term).toLowerCase(), p]));
  const order = [
    ...picked.map((t) => byTerm.get(String(t).toLowerCase())).filter(Boolean),
    ...plans.filter((p) => !picked.some((t) => String(t).toLowerCase() === String(p.term).toLowerCase())),
  ];

  /*
   * Both writers APPEND their block, so each round is composed from the
   * original page rather than from the previous round's output — building on
   * the output stacks a second PLANNED PROJECTS heading on every iteration.
   *
   * And the page arriving here may ALREADY carry planned work, because the
   * interview offers projects too: composing on top of that produced a second
   * heading and the same project listed twice with two identical sets of
   * steps. The climb decides the whole block every time, so it starts from
   * the page as the student's own facts leave it.
   */
  const base = skillPlan.withoutPlanned(String(text || ''));
  /*
   * The employer's named skills sit in LEARNING beside the ones the projects
   * carry. A student building Netflix's chaos-testing project should also see
   * "resilience patterns" and "observability" on the page as things to make
   * true — those are what the interview asks about, and the project alone
   * does not name them.
   */
  const compose = (list) => skillPlan.withPlannedSkills(
    skillPlan.withPlannedProjects(base, skillPlan.projectEntries({ ok: true, plans: list })),
    [...list.map((p) => p.term), ...houseSkills],
  );

  /*
   * More work is not always a better page.
   *
   * The first version added projects until the goal was met and handed back
   * whatever it was holding when it stopped. Thirty of them ran the page to
   * 1,205 words — two sheets of a one-sheet job — and length costs points, so
   * a climb aimed at 96 delivered 94 and blamed the student's facts for it.
   * The page that scores best is the one that gets returned, and once three
   * additions in a row have failed to improve it there is nothing left up
   * there to find.
   */
  /*
   * A plan can be a year long. A resume is one page.
   *
   * Somebody who ticks every box on a fifty-project bench has made a real
   * plan, and putting all fifty on the page produced 2,244 words and 67
   * planned lines — so length cost the points the projects were meant to win,
   * and a climb aimed at 96 delivered 94. The page carries what fits, their
   * picks first; the rest of what they chose is still theirs and is listed in
   * the build order, which is where a plan belongs.
   */
  const ON_PAGE = Math.max(1, onPage);
  /* How many additions in a row may fail to improve before the climb accepts
     there is nothing left up there. Raised on the retry that exists to match
     a score already shown, where giving up early is the whole problem. */
  const STALE = Math.max(1, stale);
  const used = [];
  let page = base;
  let projected = projectedScore(page, target);
  let best = { text: page, projected, used: [] };
  let sinceGain = 0;

  for (const plan of order) {
    /* Stop the moment the goal is met — a plan of thirty projects for a page
       that needed four is its own kind of unhelpful. Their own picks lead,
       whether or not the goal was already clear. */
    if (used.length >= ON_PAGE) break;
    if (projected >= want && used.length >= Math.min(picked.length, ON_PAGE)) break;
    used.push(plan);
    page = compose(used);
    projected = projectedScore(page, target);

    /* A pick is theirs and stays on, whatever it does to the number. */
    const mandatory = used.length <= Math.min(picked.length, ON_PAGE);
    if (mandatory || projected > best.projected) {
      best = { text: page, projected, used: [...used] };
      sinceGain = 0;
    } else if (++sinceGain >= STALE) {
      break;
    }
  }

  /* Everything they chose that the page had no room for — named, so the plan
     survives even though the sheet of paper does not grow. */
  const seatedTerms = new Set(best.used.map((p) => String(p.term).toLowerCase()));
  const alsoPlanned = order
    .slice(0, picked.length)
    .filter((p) => !seatedTerms.has(String(p.term).toLowerCase()));

  return {
    text: best.text,
    used: best.used,
    alsoPlanned,
    projected: best.projected,
    today: scanResume(best.text, target).score,
    reached: best.projected >= want,
  };
}

/**
 * What still costs points once the planned work is counted as done.
 *
 * Measured on the projection rather than on today's page, because the student
 * is being told why the climb stopped where it did — listing gaps the planned
 * projects already close would send them to fix something that is fixed.
 */
function climbReport(text, target) {
  const filledScore = projectedScore(text, target);
  if (!filledScore) return [];
  /* Same substitution projectedScore uses, so the checks read the same page. */
  const filled = String(text || '')
    .split('\n')
    .map((line) => {
      if (/^PLANNED PROJECTS/i.test(line.trim())) return 'PROJECTS';
      if (!/\[PLANNED/i.test(line)) return line;
      const body = line.replace(/^-\s*/, '').replace(/\[PLANNED[^\]]*\]\s*/i, '');
      const dash = body.indexOf(' — ');
      return `- ${dash > 0 ? body.slice(dash + 3) : body}`;
    })
    .join('\n')
    .replace(/<N>/g, '12')
    .replace(/<before>/g, '1,400')
    .replace(/<after>/g, '380')
    .replace(/<[^>]{1,40}>/g, 'the service');
  return scanResume(filled, target).checks
    .filter((c) => c.earned < c.weight)
    .sort((a, b) => (b.weight - b.earned) - (a.weight - a.earned))
    .slice(0, 3)
    .map((c) => `${c.id} (${c.detail || c.fix || 'incomplete'})`);
}

/**
 * Take a converted page to the bar, and record what had to be added.
 *
 * The tailor branch has done this since the score complaint was fixed. The
 * build-from-scratch branch never did — it converted the page and delivered
 * it — so a student who answered every question and picked a job was handed
 * 56/100 while an uploaded resume aimed at the same job came back at 96. Same
 * errand, same employer, half the score, because the two paths deliver from
 * different places in the router.
 *
 * Extracted so the from-scratch path runs the identical sequence: every
 * honest wording lever first, then the work this employer and this role call
 * for, then the floor.
 */
function tailorClimb(packet, session) {
  const FLOOR = 92;
  const TAILOR_GOAL = 95;
  const before = scanResume(packet.resume, session.scoreTarget).score;
  session.bestScore = Math.max(session.bestScore || 0, session.lastScore || 0);
  const goal = Math.max(TAILOR_GOAL, session.bestScore || 0);

  const climbed = raiseToTarget(packet.resume, session.scoreTarget, session.jd, 100);
  if (climbed.report.score > before) {
    packet.resume = climbed.text;
    if (packet.after) packet.after.checker = climbed.report.score;
  }

  const owned = (atsEngine.factLedger(packet.resume).statedSkills || []);
  const role = session.scoreTarget || session.target || '';
  const house = session.pickedJob
    ? companyProfiles.profileFor(session.pickedJob.company, role) : null;
  /*
   * One entry per project, however many lists it appears on.
   *
   * The employer's bench and the role's catalogue overlap by design — the
   * sharpest work is on both — and concatenating them without deduping put
   * the same project on the page twice: "An API somebody else could use"
   * printed as two separate planned entries with two identical sets of
   * steps. Each list dedupes internally; nothing was deduping between them.
   */
  const seenBench = new Set();
  const bench = [
    ...(house ? skillPlan.plansFor(house.projects, owned, 50) : []),
    ...skillPlan.catalogueFor(role, owned, 50),
  ].filter((p) => {
    /*
     * Deduped on the BUILD, not on the term.
     *
     * Several terms share one project — "rest api" and "api design" both
     * produce "An API somebody else could use" — so keying on term-and-build
     * let two entries through that render as the identical line, and the page
     * carried it twice with two identical sets of steps. What the student
     * sees is the build, so that is what has to be unique.
     */
    const k = String(p.build).toLowerCase();
    if (seenBench.has(k)) return false;
    seenBench.add(k);
    return true;
  });
  const picked = (session.plannedGuides || []).map((p) => p.term);

  let lift = climbToGoal(packet.resume, session.scoreTarget, goal, bench, picked,
    house ? house.skills : []);
  if (lift.projected < (session.bestScore || 0)) {
    const deeper = climbToGoal(packet.resume, session.scoreTarget, goal, bench, picked,
      house ? house.skills : [], 24, 40);
    if (deeper.projected > lift.projected) lift = deeper;
  }
  if (lift.projected < FLOOR) {
    const everything = [
      ...bench,
      ...skillPlan.plansFor(Object.values(skillPlan.DEEP_BENCH).flat(), owned, 200),
    ];
    const forced = climbToGoal(packet.resume, session.scoreTarget, Math.max(goal, FLOOR),
      everything, picked, house ? house.skills : [], 40, 200);
    if (forced.projected > lift.projected) lift = forced;
  }

  /*
   * The agent checks its own work before it hands it over.
   *
   * Everything above chooses what to add by projection. This re-reads the
   * finished page as an ATS would, and if the result is still under the bar
   * it goes back and adds more rather than shipping and hoping. It is the
   * difference between a tool that produces a page and one that produces a
   * page it has verified — and it is why a resume that came back instantly at
   * 72 was never going to get anybody shortlisted.
   *
   * Bounded, because a loop that cannot fail to terminate is worth more than
   * one that might: three passes, and the ceiling is reported honestly if the
   * facts on the page genuinely cannot reach the bar.
   */
  for (let pass = 0; pass < 3; pass += 1) {
    const check = scanResume(lift.text || packet.resume, session.scoreTarget).score;
    if (check >= FLOOR) break;
    const wider = [
      ...bench,
      ...skillPlan.plansFor(Object.values(skillPlan.DEEP_BENCH).flat(), owned, 200),
    ];
    const again = climbToGoal(packet.resume, session.scoreTarget, Math.max(goal, FLOOR),
      wider, picked, house ? house.skills : [], 16 + pass * 8, 60 + pass * 60);
    if (again.projected <= lift.projected) break;
    lift = again;
  }
  session.verified = scanResume(lift.text || packet.resume, session.scoreTarget).score;

  const startedAt = scanResume(packet.resume, session.scoreTarget).score;
  if (lift.projected >= startedAt && lift.used.length) {
    packet.resume = lift.text;
    if (packet.after) packet.after.checker = lift.projected;
    session.plannedGuides = lift.used;

    const chosen = new Set(picked.map((t) => String(t).toLowerCase()));
    const addedPast = lift.used
      .filter((p) => !chosen.has(String(p.term).toLowerCase()))
      .map((p) => p.term);
    const priority = new Set(
      (house ? house.projects : []).slice(0, 8).map((t) => String(t).toLowerCase()),
    );
    session.overruled = {
      picked,
      added: addedPast,
      theirPriorities: addedPast.filter((t) => priority.has(String(t).toLowerCase())),
      declined: picked.length === 0,
      company: session.pickedJob ? session.pickedJob.company : '',
    };
  }
  session.bestScore = Math.max(session.bestScore || 0,
    scanResume(packet.resume, session.scoreTarget).score);
  return packet;
}

/** The finished job, in one response the client already knows how to render. */
function deliver(res, session, packetOrBuilt, kindNote) {
  const isPacket = Boolean(packetOrBuilt.resume);
  let text = isPacket ? packetOrBuilt.resume : packetOrBuilt.text;
  const command = session.command;
  session.asked = null;
  session.lastCommand = command; /* what this page was last put through */
  session.command = null; /* done — the next message starts fresh, with the facts kept */

  /*
   * The planned project survives the rewrite.
   *
   * A tailor regenerates the page from the ledger, and the planned block is
   * not in the ledger — it is a note about work that does not exist yet. So
   * it was silently dropped by the very pass the student asked for it in,
   * taking the export gate with it.
   */
  if (session.plannedGuide && !/PLANNED PROJECTS/i.test(text)) {
    text = skillPlan.withPlannedProjects(text, skillPlan.projectEntries({
      ok: true, plans: [session.plannedGuide],
    }));
    session.resumeText = text;
  }

  /* A shipped resume is what cover and prep are allowed to work from. */
  session.shipped = { text, target: session.target, jd: session.jd };

  /*
   * Filed beside the master rather than over it.
   *
   * Every tailoring used to replace the last, so somebody who tailored for
   * one company on Monday and another on Tuesday had a single file by
   * Tuesday evening and no way back to Monday's. A version keeps the note it
   * shipped with — the score and what it did not claim — because a document
   * opened in three weeks needs its caveat as much as its text.
   */
  if (isPacket || command === 'build') {
    session.library = library.saveVersion(
      library.setMaster(session.library, session.library && session.library.master ? session.library.master : text),
      {
        text,
        /* Named from whatever is actually known — the company they said, the
           role they targeted, or the title on the page — so the library does
           not fill up with rows called "unnamed-role". */
        company: (session.details && session.details.company) || null,
        role: session.target || (session.details && session.details.position)
          || atsEngine.factLedger(text).title || null,
        jd: session.jd,
        score: session.lastScore,
        notClaimed: isPacket ? packetOrBuilt.notClaimed : [],
      });
  }

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
  /*
   * One yardstick for the whole session.
   *
   * The score is measured against the keyword bank for a role, and picking a
   * job changes the role — so a DevOps page scored against the backend bank
   * came back a point lower and read as "tailoring made it worse". It had
   * not changed at all; it had been measured with a different ruler.
   *
   * The first target seen is the one the number is always reported against,
   * so it means the same thing on every turn. How well the page fits the job
   * just chosen is a different question, and the match line answers it.
   */
  if (session.scoreTarget === undefined) session.scoreTarget = session.target || '';

  session.resumeText = text;
  if (isPacket) {
    session.lastPacket = {
      band: packetOrBuilt.band,
      notClaimed: packetOrBuilt.notClaimed,
      after: packetOrBuilt.after,
      dropped: packetOrBuilt.essentials.dropped,
    };
  }

  /* Built after the page is final — see below. A header computed here scored
     the packet's text, and the LEARNING block is added to `text` afterwards,
     so the reply announced 92 above a resume the same response reported as
     94. One page, one number. */
  let header;

  /*
   * The gap, and the offer to close it, at the moment it is visible.
   *
   * A tailored page ships with a Not-claimed list, which tells somebody what
   * they are missing and nothing about what to do next — so the terms sit
   * there looking like a verdict. They are a to-do list, and the plan that
   * turns them into buildable weekends is one sentence away.
   */
  /*
   * What changed, and what to do before this page goes anywhere.
   *
   * A rewrite that arrives silently leaves the student guessing what moved.
   * And a planned project on the page is a promise to themselves, not a
   * claim — so the steps that make it real come with it, here, at the moment
   * they are looking at the version they want to send.
   */
  const guide = session.plannedGuide;
  const guides = session.plannedGuides || (guide ? [guide] : []);

  /* Today's number, and what the planned work is worth — side by side, so
     "will this get me to 98?" has an answer that is not a guess. */
  const projected = guides.length ? projectedScore(text, session.target) : null;
  const nowScore = (scanResume(text, session.target) || {}).score;

  const updatedNote = [
    session.details.leadProject || session.details.leadSkill
      ? `Updated: this version leads with ${[
        session.details.leadProject ? 'the work you picked' : '',
        session.details.leadSkill ? `${session.details.leadSkill} first on the skills line` : '',
      ].filter(Boolean).join(', and ')}.`
      : '',
    guides.length
      ? [
        `Added ${guides.length === 1 ? '1 project' : `${guides.length} projects`} under PLANNED PROJECTS, with the numbers left blank.`,
        '',
        `**Your page is ${nowScore}/100 today, and ${projected}/100 once ${guides.length === 1 ? 'this is' : 'these are'} built.** That gap is the work, not the wording — no rewrite closes it.`,
        '',
        '**Do not send this yet.** It will not export to PDF while anything is marked planned: a project you cannot walk through fails the first question an interviewer asks about it.',
        ...guides.flatMap((g) => [
          '',
          `**${g.build}** · ${g.hours}`,
          ...g.steps.map((s, i) => `${i + 1}. ${s}`),
          `Be ready for: ${g.defend}`,
        ]),
        '',
        'As each one is finished, say "I built it" and give me the real numbers — I will move it into your actual Projects section and the score becomes real.',
      ].join('\n')
      : '',
  ].filter(Boolean).join('\n\n');

  /* A tailored page and a letter for the same posting are one errand, and we
     already know which job it is for. */
  const coverOffer = session.pickedJob
    ? `Want a cover letter for ${session.pickedJob.title} at ${session.pickedJob.company}? Say "yes, write the letter".`
    : '';

  /*
   * The posting's skills go onto the page, with the plan to make them true.
   *
   * A tailored resume that ends "Missing keywords: linux, ci/cd, monitoring"
   * tells a student what is wrong and nothing about what to do, at the exact
   * moment they were expecting the finished thing. The point of the tool is
   * to close that gap, not to name it — so the skills are added, marked as
   * not yet true, and each one comes with what to do before the day they
   * apply. The export stays shut until they say the work is done, which is
   * what keeps this a plan rather than a lie.
   */
  /* The role is not a skill to learn. "Backend" turned up in the list beside
     Kafka and Terraform — it is the job being applied for. */
  const ROLE_WORDS = /^(backend|frontend|full[- ]?stack|software|senior|junior|lead|staff|principal|engineer|developer|analyst|scientist|manager|intern|devops|sre)$/i;
  /*
   * A target has no advert, so its skills come from the employer instead.
   *
   * Tailoring against one of the large employers produced an empty LEARNING
   * block, because the list was built from terms the posting named and a
   * target has no posting. What that company screens the role on is exactly
   * as real a list, and it is the one somebody aiming there needs.
   */
  const houseSkills = session.pickedJob
    ? companyProfiles.profileFor(
      session.pickedJob.company,
      session.target || session.scoreTarget || '',
    ).skills.slice(0, 4)
    : [];
  const fromPosting = isPacket && Array.isArray(packetOrBuilt.notClaimed)
    ? packetOrBuilt.notClaimed.filter((t) => !ROLE_WORDS.test(String(t).trim()))
    : [];
  const wantedSkills = [...new Set([...fromPosting, ...houseSkills])].slice(0, 6);

  if (isPacket && wantedSkills.length && !/LEARNING \(/i.test(text)) {
    text = skillPlan.withPlannedSkills(text, wantedSkills);
    session.resumeText = text;
    session.plannedSkills = wantedSkills;
  }

  /*
   * What this employer reads for, on the page they are being handed.
   *
   * It was said once, on the question about which projects to build, and then
   * never again — so the student who answered that question got the finished
   * resume with no word about what Amazon leads with versus what a bank leads
   * with. The advice belongs next to the artefact it applies to.
   */
  const houseNote = isPacket && session.pickedJob
    ? companyProfiles.noteFor(session.pickedJob.company, session.target || session.scoreTarget || '')
    : '';

  const learnNote = isPacket && wantedSkills.length
    ? [
      `Added to your page under LEARNING: ${wantedSkills.join(', ')} — marked as not yet true, because they are not yet true.`,
      '',
      '**Make them real before you send this.** The page will not export while anything is marked planned, and that is the point: these are on your resume the day you can walk through them, not before.',
      ...wantedSkills.slice(0, 3).flatMap((s) => {
        const p = skillPlan.learnPlan(s);
        return ['', `**${s}** · ${p.hours}`, ...p.steps.map((x, i) => `${i + 1}. ${x}`), p.proof];
      }),
      '',
      'When one is done, say "I built it" with what you actually made and I will move it into your real skills.',
    ].join('\n')
    : '';

  /*
   * The whole reply: the score, then the work, in points. Nothing else.
   *
   * It had grown into six blocks — what changed, what the employer screens
   * on, a JD gap table, a not-claimed list, a to-do offer, and a cover-letter
   * offer — stacked above the one thing a student actually has to act on. The
   * brief is exactly this and no more: show the resume, show the ATS score,
   * and end with how to finish the projects and learn the skills before the
   * page is attached to an application.
   *
   * Everything that was cut is still reachable by asking for it. None of it
   * belongs on top of the artefact.
   */
  const planned = [
    ...guides.map((g) => ({ title: g.build, hours: g.hours, steps: g.steps })),
    ...wantedSkills.map((s) => {
      const p = skillPlan.learnPlan(s);
      return { title: s, hours: p.hours, steps: p.steps };
    }),
  ];

  /* The count is the list. It used to say seventeen and print four, because
     the skills were sliced after they were counted. */
  /*
   * One line when the page carries more than was chosen, and why.
   *
   * Adding work somebody did not pick is a decision made on their behalf. It
   * is the right decision — a page below the bar is filtered before a person
   * reads it, and "you chose these three and they were not enough" is what a
   * good mentor says out loud — but it has to be said, not slipped in.
   */
  const ov = session.overruled;
  const overruledNote = ov && ov.added && ov.added.length
    ? (ov.declined
      ? `You did not want to pick any, so I chose the ${ov.added.length} that get this page past the bar${ov.company ? ` for ${ov.company}` : ''}: ${ov.added.slice(0, 6).join(', ')}. Swap any of them for work you would rather do — the page holds as long as the replacement is the same size.`
      : `Your picks are on the page and stay there. ${ov.added.length} more went on behind them, because your picks alone did not cover what ${ov.company || 'this employer'} screens this role on${ov.theirPriorities.length ? ` — specifically ${ov.theirPriorities.slice(0, 3).join(', ')}` : ''}.`)
    : '';

  const plan = planned.length
    ? [
      overruledNote,
      overruledNote ? '' : null,
      `Before you attach this: ${planned.length} thing${planned.length === 1 ? '' : 's'} on the page are marked planned and are not true yet.`,
      ...planned.flatMap((p) => [
        '',
        `- **${p.title}** · ${p.hours}`,
        ...p.steps.map((s) => `  - ${s}`),
      ]),
    ].join('\n')
    : '';

  /* The score leads every delivered page, packet or not — a raise that ends
     "Proxy only." and nothing else is a page handed over with no number on
     it, which is the one thing the reply exists to say. */
  header = isPacket
    ? deliveryHeader('A', command || 'tailor', packetOrBuilt.band,
      { ...packetOrBuilt, resume: text, target: session.scoreTarget })
    : `ATS score: ${scanResume(text, session.scoreTarget).score}/100`;

  /*
   * Recorded from the page that was actually handed over.
   *
   * It used to be taken before the LEARNING block was added, so the session
   * remembered 92 for a page the same reply announced as 94 — and the ratchet
   * that stops the next company scoring lower was comparing against a number
   * the student never saw.
   */
  const delivered = scanResume(text, session.scoreTarget);
  session.lastScore = delivered.score;
  session.bestScore = Math.max(session.bestScore || 0, delivered.score);

  return res.json({
    ok: true, kind: 'build',
    /* Score, the one sentence the command wanted to say, then the work in
       points. The tailor passes no sentence at all, which is why its reply is
       the two lines the brief asks for and nothing more. */
    reply: [header, kindNote, plan].filter(Boolean).join('\n\n'),
    text,
    report: scanResume(text, session.scoreTarget),
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

    /*
     * The yardstick is fixed the moment a resume arrives.
     *
     * Setting it on the first delivery was too late: the first turn is a
     * scan, so by the time anything shipped the student had already picked a
     * job and the target had moved — which is what made a DevOps page score
     * a point lower against a backend bank and read as damage.
     */
    if (session.scoreTarget === undefined && String(session.resumeText || '').trim()) {
      /*
       * Pinned to the role the resume itself claims, not left empty.
       *
       * An empty target makes the scorer read the bank off the page's own
       * title line — and tailoring rewrites that line to the job being
       * targeted. So a frontend engineer aiming at a backend role had their
       * page re-measured against backend keywords and shown 89 → 85: a true
       * fact about the fit, printed where a verdict on their resume goes.
       * Fixing the bank at what they actually are keeps the number about the
       * page, and the match line keeps saying how well it suits the job.
       */
      session.scoreTarget = session.target
        || atsEngine.factLedger(session.resumeText).title
        || '';
    }
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

    /*
     * A row from the job list becomes the target, before anything dispatches.
     *
     * "Tailor my resume for the Site Reliability Engineer role at
     * commercetools" is a tailor request that already names its posting, and
     * so is "tailor number 2" — the list is on screen and numbered, and a
     * number is how a person refers to a row. Resolving it here means the
     * tailor that follows knows which job it is for, which is also what lets
     * the letter be offered for that job by name.
     */
    if (Array.isArray(session.jobs) && session.jobs.length && /(tailor|apply)/.test(low)) {
      const numbered = low.match(/\b(?:tailor|number|row|option|no\.?|#)\s*(\d{1,2})\b/) || low.match(/\b(\d{1,2})\b/);
      /*
       * The company decides which row, not the title.
       *
       * Every target row carries the SAME title — the role being aimed at —
       * so matching on the title alone returned whichever came first in the
       * list. Somebody opened OpenAI, pressed Tailor, and the page was
       * rewritten for Google: the sentence said OpenAI, the lookup read
       * "backend engineer", and Google was row one. The company is the only
       * part of "the <role> role at <company>" that tells two rows apart, so
       * it is matched first, and the title is the tie-break within a company
       * that has several openings.
       */
      const hasCompany = (j) => j.company &&
        low.includes(String(j.company).toLowerCase());
      const hasTitle = (j) => j.title &&
        low.includes(String(j.title).toLowerCase().slice(0, 24));
      const named = session.jobs.find((j) => hasCompany(j) && hasTitle(j))
        || session.jobs.find(hasCompany)
        || session.jobs.find(hasTitle);
      const job = named || (numbered ? session.jobs[parseInt(numbered[1], 10) - 1] : null);
      if (job) {
        session.target = job.title;
        /* The posting's own text is the job description — tailoring against
           a title maps a title and nothing else. */
        /*
         * A city is not a skill.
         *
         * The location went into the posting text and came straight back out
         * as a hard requirement: a page was told it could not prove
         * "Bengaluru", the word was added under LEARNING, and the agent
         * offered to walk somebody through "the official Bengaluru
         * getting-started guide". Where a job is stays on the job, where it
         * belongs; what it asks for is the title, the description and the
         * tags.
         */
        session.jd = [
          `${job.title} at ${job.company}.`,
          job.description || '',
          (job.tags || []).join(', '),
        ].filter(Boolean).join('\n');
        /*
         * A different employer is a different tailor, from scratch.
         *
         * The picks were kept across jobs, and on a weak resume they are made
         * during the UPLOAD interview — so by the time somebody chose Google
         * the page already carried a generic backend plan, those stale terms
         * led the climb, and the twelve slots filled with Redis, Kubernetes
         * and Terraform before a single thing Google actually screens on got
         * a look in. The page said "tailored for Google" and contained
         * nothing of Google.
         *
         * Choosing a row clears the previous row's answers, so the question
         * is asked again for this employer and this employer's bench leads.
         */
        if (!session.pickedJob || session.pickedJob.company !== job.company) {
          session.tailorPicked = false;
          session.plannedGuides = null;
          session.plannedGuide = null;
          delete session.details.addProject;
          session.declined = (session.declined || []).filter((f) => f !== 'addproject');
        }
        session.pickedJob = job;
        /*
         * A target rather than a posting widens the bench.
         *
         * Tailoring for Google is not tailoring for the shop down the road:
         * there is no advert to match, only a bar, and the honest catalogue
         * for that is everything the domain expects rather than the four
         * things one listing happened to name.
         */
        session.aspirational = !!job.aspirational;
        /* Pressing Tailor states an intention, not a decision: the agent
           names the job and waits for a yes before rewriting the page. */
        if (/\bi want to tailor\b/.test(low)) session.pendingTailor = job;
      }
    }

    /*
     * A posting awaiting confirmation outranks the word "tailor" in the
     * sentence that raised it — but never outranks a question already on
     * screen. Treating the "yes" that answers the confirmation as a command
     * meant the answer was never consumed, so the question asked itself
     * again, and again.
     */
    /*
     * The company, the role and the level, read out of the sentence.
     *
     * "Tailor this resume and make it 98/100 for google backend engineer role
     * entry level" names four things, and all four were being thrown away —
     * the reply asked which job title to target, on a line that had just said
     * it. Whatever the sentence states, the agent should already know.
     */
    if (/\bfor\b/.test(low) && !session.asked) {
      const roleAt = low.match(/\bfor (?:the )?([a-z0-9][\w.& -]{2,44}?)\s+(?:role|position|job|opening)\b/);
      /* "for the stripe backend engineer role" — the article is not the
         employer, and capturing it named a company called "the". */
      const companyRole = low.match(
        /\bfor (?:the\s+)?([a-z0-9][\w.&-]{2,30})(?:'s)?\s+((?:[a-z]+\s+){0,3}(?:engineer|developer|analyst|scientist|designer|manager|intern))\b/);

      if (companyRole) {
        const [, company, role] = companyRole;
        if (!session.details.company) session.details.company = company.replace(/\b\w/g, (c) => c.toUpperCase());
        if (!session.target) session.target = role.trim();
      } else if (roleAt) {
        /* "for the backend engineer role" — a title, with no employer. */
        const said = roleAt[1].replace(/\b(entry|junior|senior|mid|lead|staff)\s+level\b/g, '').trim();
        if (said && !session.target) session.target = said;
      }

      const level = low.match(/\b(entry|junior|mid|senior|lead|staff|principal)[\s-]*level\b/);
      if (level && !session.details.level) session.details.level = level[1];
    }

    /*
     * An answer to a pick is an answer, whatever words are in it.
     *
     * The options are the student's own bullets, so picking two of them sends
     * back a sentence full of their numbers — "cutting deploy time from 40 to
     * 6 minutes" — and a two-digit number anywhere in a message routed the
     * whole turn to `raise`. The pick was discarded, the question was
     * forgotten, and the answer was filed as new experience.
     */
    const PICK_FIELDS = ['leadproject', 'leadskill', 'addproject', 'confirmtailor', 'jobrole'];
    const answeringPick = PICK_FIELDS.includes(session.asked);

    const command = answeringPick ? null
      : pastedResume ? 'check'
        : looksLikePaste ? null
        : (session.pendingTailor && !session.asked) ? 'jobs-confirm'
          : commandOf(low, Boolean(req.file));
    if (command) {
      /*
       * A second run on the same resume is a second run, not a continuation.
       *
       * Asking to tailor once recorded the picks and the declines, and they
       * stayed recorded — so asking again skipped every question and handed
       * back the same page in silence. A student could not use their own
       * resume twice, which is precisely what somebody does when they are
       * applying to more than one job. Starting a tailor or a raise clears
       * what was picked last time; the resume, the ledger and the history
       * are untouched.
       */
      /*
       * "A second run" means a different run, and delivering clears
       * session.command — so every repeat of "make it 98" compared 'raise'
       * against null, called itself new, and wiped the picks, the declines
       * and the list of bullets already put to them. The page then re-offered
       * the same catalogue and re-printed the same worklist for as long as
       * anybody kept asking, which is the repetition this reset was written to
       * prevent. lastCommand survives delivery, so a repeat is recognised.
       */
      const prevCommand = session.command || session.lastCommand;
      if ((command === 'tailor' || command === 'raise') && command !== prevCommand) {
        session.tailorPicked = false;
        session.raiseDelivered = false;
        session.raiseAsked = false;
        session.bulletsAsked = [];
        session.toldExhausted = false;
        session.plannedGuides = null;
        session.plannedGuide = null;
        delete session.details.leadProject;
        delete session.details.leadSkill;
        delete session.details.addProject;
        session.declined = (session.declined || [])
          .filter((f) => !['leadproject', 'leadskill', 'addproject'].includes(f));
      }

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
      /* No banner. The question is the message; which branch produced it was
       never the student's business. */
    const head = null;
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
      /* The pinned yardstick, so the first number and every later one are
       measured the same way. */
    const report = scanResume(session.resumeText, session.scoreTarget);
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
        /*
         * One scale, everywhere, from the first number to the last.
         *
         * This said "estimated checker 45/60" — the first number a student
         * ever sees — and every number after it was out of 100. Two scales in
         * one conversation is how a page that went 45 to 94 reads as noise,
         * and it is the same complaint as the header that quoted a different
         * total from the report beside it.
         */
        const prompt = `Your resume scores ${scanResume(session.resumeText, session.scoreTarget).score}/100 as it stands. That is below what an ATS lets through, so I will rebuild it rather than polish it. A few questions first.`;
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
      /*
       * Ask for a project and a skill to pick, not for an essay.
       *
       * "What else have you done?" is a blank page handed to somebody who
       * came here because they did not know what to write. The gap is
       * already computed — which of the target role's tools their page cannot
       * show — so it becomes three projects to choose between, each with the
       * steps to build it. Choosing is a second; composing is why they gave
       * up last time.
       */
      /*
       * Picked projects end the raise, with both numbers.
       *
       * The turn after the picks used to fall through to the bullet worklist,
       * so the student answered the question and got a table instead of the
       * page — and never saw what the work they had just committed to was
       * worth. What they asked for was a target; this is where it is given.
       */
      /*
       * The catalogue the climb is drawn from.
       *
       * Whatever the posting names comes first, because that is the job in
       * front of them. Behind it sits the domain's whole bench, so a page
       * aimed at Google is not offered five projects and then a ceiling — the
       * request was for a number, and reaching it takes as many as it takes.
       * Aiming at one of the big names widens it further: those are the pages
       * that need twenty-five, not five.
       */
      const skillsCheck = (out.report.checks || []).find((c) => c.id === 'skills');
      const missingWords = skillsCheck && skillsCheck.fix
        ? (skillsCheck.fix.match(/:\s*(.+)\.$/) || [, ''])[1].split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const deep = session.aspirational ? 50 : 25;
      const jdPlan = session.jd ? skillPlan.planFor(out.text, session.jd, { limit: deep }) : null;
      const targetPlan = skillPlan.planForTarget(out.text, missingWords, { limit: deep });
      const evidenced = (atsEngine.factLedger(out.text).statedSkills || []);
      const roleForBench = session.scoreTarget || session.target ||
        atsEngine.factLedger(out.text).title || '';
      /*
       * The employer's own bar, ahead of the domain's.
       *
       * Tailoring for Google and for JPMorgan used to produce the same
       * twenty-five projects, and they are not the same job — one screens on
       * distributed systems under load, the other on correctness and an audit
       * trail. Whoever the page is aimed at decides what leads the list; the
       * role's bench still fills in behind, because a backend engineer at a
       * bank is still a backend engineer.
       */
      const house = session.pickedJob
        ? companyProfiles.profileFor(session.pickedJob.company, roleForBench)
        : null;
      const housePlans = house ? skillPlan.plansFor(house.projects, evidenced, deep) : [];
      const bench = skillPlan.catalogueFor(roleForBench, evidenced, deep);
      const seenTerm = new Set();
      const catalogue = [
        ...housePlans,
        ...((jdPlan && jdPlan.ok && jdPlan.plans) || []),
        ...((targetPlan && targetPlan.ok && targetPlan.plans) || []),
        ...bench,
      ].filter((p) => {
        /* Dedupe on the build as well as the term: "sql" and "database" are
           two words for one recipe, and the page came back listing "A schema
           with real data in it" twice as separate work. */
        const k = String(p.term).toLowerCase();
        const b = String(p.build).toLowerCase();
        if (seenTerm.has(k) || seenTerm.has(b)) return false;
        seenTerm.add(k);
        seenTerm.add(b);
        return true;
      }).slice(0, deep);

      /*
       * Their picks go on, and then the page keeps climbing to the number.
       *
       * Two ways this used to fail the same person. Pick the weak project and
       * the page stopped a few points short of the goal they had named, with
       * no word about the gap. Decline the recommendations and the turn fell
       * through to a ceiling sentence — asked for 96, told 89 and no. Both are
       * answerable: the picks are honoured first, in their order, and the rest
       * of the bench is added behind them until the projection clears the bar.
       * A declined recommendation is a preference about which project, not a
       * refusal of the score they asked for.
       */
      const picked = (session.plannedGuides || []).map((p) => p.term);
      const declinedProjects = (session.declined || []).includes('addproject') ||
        session.details.addProject === 'skip';
      const alreadyAsked = picked.length || declinedProjects || session.raiseAsked;

      /*
       * Climb once per goal, then move on to the lines.
       *
       * Delivering clears session.command, so the next "make it 98" looked
       * like a fresh raise, reset the picks, and offered the same catalogue
       * again — ask, deliver, ask, deliver, for as long as somebody kept
       * asking. The page has already been taken to that number; what is left
       * to say about it is which bullets are weak, which is the worklist
       * below.
       */
      const alreadyClimbed = (session.climbedTo || 0) >= goal &&
        skillPlan.plannedLines(session.resumeText).length > 0;

      if (!alreadyClimbed && alreadyAsked && !session.raiseDelivered && catalogue.length) {
        session.raiseDelivered = true;
        const climb = climbToGoal(out.text, session.scoreTarget, goal, catalogue, picked,
          house ? house.skills : []);
        session.resumeText = climb.text;
        session.pendingRaise = null;
        session.climbedTo = Math.max(session.climbedTo || 0, goal);
        session.command = 'raise';

        /* Everything the climb put on the page is what the delivery lists the
           steps for — not just the handful they picked, because every one of
           those lines is marked planned and every one has to become true. */
        session.plannedGuides = climb.used;
        const overflow = (climb.alsoPlanned || []).length
          ? `Also on your plan, once the page has room: ${climb.alsoPlanned.map((p) => p.term).join(', ')}. A resume is one sheet — finish the ${climb.used.length} above and swap these in as they land.`
          : '';
        /*
         * When the bench runs out short of the goal, name what is holding it.
         *
         * The gap is usually not work at all — a missing GitHub line, no
         * education section, one dated role — facts the student already has
         * and simply did not put on the page. Saying "the honest top" and
         * stopping leaves them to guess which; saying which turns the last
         * few points into a one-line edit.
         */
        const stillShort = climb.reached ? [] : (climbReport(climb.text, session.scoreTarget) || []);
        /*
         * One sentence, because the steps now print themselves.
         *
         * This block used to restate the build order and the marker rule that
         * the delivery already lists underneath it, in points — the same
         * information twice, the second time in prose. What only this branch
         * knows is the goal that was asked for and whether it was met.
         */
        const note = [
          climb.reached
            ? `You asked for ${goal}. This page scores ${climb.projected}/100 with the work below on it.`
            : `You asked for ${goal}. ${climb.projected}/100 is the honest top for this role — the rest needs facts your page does not show, and I will not invent them.${stillShort.length ? ` Still costing points: ${stillShort.join('; ')}.` : ''}`,
          picked.length && climb.used.length > picked.length
            ? `Your picks lead; ${climb.used.length - picked.length} more were added behind them to reach it.`
            : '',
          overflow,
        ].filter(Boolean).join(' ');

        return deliver(res, session, {
          text: climb.text,
          report: scanResume(climb.text, session.scoreTarget),
          missing: [],
          potentialScore: climb.projected,
        }, note);
      }

      const rPlan = (jdPlan && jdPlan.ok && jdPlan.plans.length) ? jdPlan : targetPlan;

      if (!alreadyClimbed && catalogue.length &&
          !session.details.addProject && !(session.declined || []).includes('addproject')) {
        session.raiseAsked = true;
        session.asked = 'addproject';
        /* The catalogue is what was rendered, so the catalogue is what a pick
           is resolved against — caching the narrower plan meant choosing an
           option from further down the list resolved to nothing, and the page
           climbed without the project they had actually asked for. */
        session.planCache = { ok: true, plans: catalogue, missing: catalogue.map((p) => p.term) };
        session.resumeText = out.text;
        session.pendingRaise = goal;
        return res.json({
          ok: true,
          kind: 'ask',
          /* The goal they named stays in front of them — a person who asked
             for 88 is owed the distance to 88, not to a number we prefer. */
          reply: `You asked for ${goal}. It is at ${out.report.score}/100 today. ${house ? `${companyProfiles.noteFor(session.pickedJob.company, roleForBench)} Their work leads the list` : `Here is the whole bench for ${roleForBench || 'this role'}`} — ${catalogue.length} project${catalogue.length === 1 ? '' : 's'}, strongest first${(rPlan && rPlan.ok && rPlan.missing || []).length ? `, starting with ${rPlan.missing.slice(0, 3).join(', ')}` : ''}. Pick as many as you want; each goes on the page with its steps. Pick none and I will still take you to ${goal} with the ones that get you there fastest.`,
          options: {
            /* Several, because one project rarely closes a gap and a student
               planning a month of work should be able to plan all of it. */
            multi: true,
            options: catalogue.map((p) => ({
              label: `${p.build} (${p.term})`,
              note: `${p.hours} · production-grade`,
              value: p.term,
            })),
            other: { label: 'None of these', value: 'skip' },
          },
          session,
        });
      }

      /*
       * "What else have you done?" is gone, and so is the per-bullet metric
       * question behind it.
       *
       * Both were essays. A student who could write the missing bullet would
       * not have needed the agent, and being asked four times in a row for
       * "another project, a hackathon, a paper" is the blank page again with
       * a friendlier voice. Length is still the gap on a short page — the
       * projects offered above are what close it, and they are picked, not
       * written.
       */

      /*
       * The per-bullet worklist is a report, never a question.
       *
       * It used to end each round by asking "what number belongs on this
       * line?" — one bullet at a time, typed. It stays as a list of what is
       * weak and what would fix it, because that is genuinely useful to read;
       * it no longer asks anything.
       */
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
        if (queue.length && !session.bulletsAsked.length) {
          session.bulletsAsked = queue.map((r) => r.text);
          const target = queue[0];
          const firstRound = true;
          return res.json({
            ok: true,
            kind: 'help',
            reply: [
              firstRound
                ? `Checker ${out.report.score}/100 and formatting is spent — the rest of the points are in the lines themselves. ${audit.strong}/${audit.total} bullets already pull their weight. These are the ${queue.length} worth fixing first${audit.weak.length > queue.length ? `, out of ${audit.weak.length}` : ''}.`
                : `Checker ${out.report.score}/100.`,
              '',
              ...(firstRound ? [
                '| Line | What is wrong | What fixes it |',
                '|---|---|---|',
                ...queue.map((r) =>
                  `| ${r.text.replace(/\|/g, '\\|')} | ${r.problems.join('; ')} | ${(r.fix || '').replace(/\|/g, '\\|')} |`),
                '',
              ] : []),
              /* A report, not a prompt: it shows what is weak and moves on. */
              'Fixing any of those lines moves the number the same turn. Or say "make it 98" again and pick a project to build — that is the faster route from here.',
            ].filter(Boolean).join('\n'),
            session: Object.assign(session, { asked: null, command: null }),
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
              `Checker ${out.report.score}/100, and I have asked about every line that is holding it there — ${audit.weak.length} of them. None of the remaining points are formatting, so there is nothing left for me to spend.`,
              'Give me a number for any of those lines, or a project that shows the target role\'s stack, and the score moves the same turn. Otherwise this is the honest version.',
            ].join('\n\n'),
            session,
          });
        }
      }

      /*
       * The last essay question, and it is gone too.
       *
       * "The next 9 points need one real number for your strongest bullet"
       * is true, and it is still a blank page. What is missing is stated in
       * the ceiling below, where it is information rather than homework — and
       * the projects offered above are the route that does not require the
       * student to write anything.
       */

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

    /*
     * The confirmation for a posting the student pressed Tailor on, and the
     * answer to it.
     */
    if (session.tailorConfirmed === false) {
      session.tailorConfirmed = null;
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: 'Left as it is. Open another opening whenever you want to compare, or say "find me jobs" to search again.',
        session,
      });
    }
    if (session.tailorConfirmed === true) {
      session.tailorConfirmed = null;
      session.command = 'tailor';
    } else if (session.command === 'jobs-confirm' && session.pendingTailor) {
      const j = session.pendingTailor;
      return ask('confirmtailor',
        `Should I tailor your resume for ${j.title} at ${j.company}? I will rewrite the wording against this posting and keep every fact exactly as it is on your page.`);
    }

    /*
     * Before tailoring: what to lead with, and what to build next.
     *
     * The rewrite has to decide what goes first, and it was deciding by
     * keyword count — which puts whichever line shares the most words with
     * the advert at the top, regardless of what the person would actually
     * want to be asked about. They are their projects. And the gap between
     * what the posting wants and what the page proves is already computed,
     * so it becomes "here are three projects that would close it, pick one"
     * rather than a list of missing words.
     */
    /* Every tailor, not only one that came from a job row: the picks are what
       replaced the essay questions, so they cannot depend on how you arrived. */
    if (session.command === 'tailor' && session.resumeText.trim() && !session.tailorPicked) {
      const led = atsEngine.factLedger(session.resumeText || '');
      const mine = [
        ...led.projects.flatMap((p) => p.bullets || []),
        ...led.roles.flatMap((r) => r.bullets || []),
      ].map((s) => String(s).trim()).filter((s) => s.split(/\s+/).length > 4).slice(0, 6);
      const skills = [...new Set([...led.evidencedSkills, ...led.statedSkills])].slice(0, 10);
      const declinedNow = session.declined || [];

      if (!session.details.leadProject && mine.length > 1 && !declinedNow.includes('leadproject')) {
        session.asked = 'leadproject';
        return res.json({
          ok: true, kind: 'ask',
          reply: 'Which of your work should this version lead with? Pick the ones you would most want to be asked about — they go first on the page.',
          options: {
            multi: true,
            options: mine.map((p) => ({ label: p.slice(0, 90), value: p })),
            other: { label: 'Decide for me', value: 'skip' },
          },
          session,
        });
      }

      if (!session.details.leadSkill && skills.length > 1 && !declinedNow.includes('leadskill')) {
        session.asked = 'leadskill';
        return res.json({
          ok: true, kind: 'ask',
          /* Several, in the order they pick them — a skills line is ordered,
             and the first three are the ones a reader actually takes in. */
          reply: 'Which skills should lead your skills line? Pick the ones you can defend in most detail — they go first.',
          options: {
            multi: true,
            options: skills.map((s) => ({ label: s, value: s })),
            other: { label: 'Decide for me', value: 'skip' },
          },
          session,
        });
      }

      /*
       * The employer's own bench, and as deep as the employer warrants.
       *
       * Three projects off the advert is right for a small company with a
       * specific posting and thin for one of the large employers, where there
       * is no advert at all — only a bar. Whoever the page is aimed at leads
       * the list, the posting's gaps follow, and picking is still picking.
       */
      const tailorRole = session.target || atsEngine.factLedger(session.resumeText).title || '';
      const tailorHouse = session.pickedJob
        ? companyProfiles.profileFor(session.pickedJob.company, tailorRole) : null;
      const width = session.aspirational ? 50 : 12;
      const jdSide = session.jd ? skillPlan.planFor(session.resumeText, session.jd, { limit: width }) : null;
      const owned = [...new Set([...led.evidencedSkills, ...led.statedSkills])];
      const seenPlan = new Set();
      const offer = [
        ...(tailorHouse ? skillPlan.plansFor(tailorHouse.projects, owned, width) : []),
        ...((jdSide && jdSide.ok && jdSide.plans) || []),
      ].filter((p) => {
        const k = String(p.term).toLowerCase();
        const b = String(p.build).toLowerCase();
        if (seenPlan.has(k) || seenPlan.has(b)) return false;
        seenPlan.add(k); seenPlan.add(b);
        return true;
      }).slice(0, width);

      /*
       * The dates, when the page has none, before anything else is asked.
       *
       * Ten points sit on this check and no rewrite can reach them: a resume
       * with no date beside any role scores zero for dates whatever else is
       * done to it, and that alone is the difference between the high
       * eighties and the ninety this is meant to deliver. It is one pick.
       */
      /*
       * Asked whenever the check is SHORT, not only when it is empty.
       *
       * The trigger was earned === 0, so a page with one dated role and one
       * bare one sat at 5/10 and was never asked — five points lost on a fact
       * the student had in their head, because the page was not quite bare
       * enough to qualify. Ten points, or five, is the difference between the
       * high eighties and the bar this is meant to clear.
       */
      const dateCheck = scanResume(session.resumeText, session.scoreTarget).checks
        .find((c) => c.id === 'dates') || {};
      /*
       * Asked once per bare role, and never more than twice.
       *
       * Widening the trigger from "no dates at all" to "not enough dates"
       * caught the five-point case and reintroduced the oldest bug in this
       * file: an answer that does not fully close the gap leaves the
       * condition true, so the identical sentence comes back on the next
       * turn. Asked once, then never again: a second ask lands as the same
       * sentence twice in a row, which is the thing this whole file has been
       * fighting, and the remaining points are reported rather than demanded.
       */
      session.dateAsks = session.dateAsks || 0;
      if (!declinedNow.includes('roledates') && dateCheck.earned < dateCheck.weight
          && session.dateAsks < 1) {
        session.dateAsks += 1;
        session.asked = 'roledates';
        return res.json({
          ok: true,
          kind: 'ask',
          reply: dateCheck.earned === 0
            ? 'Your page has no dates next to any role, which costs it ten points on its own — no ATS can read a history it cannot place in time. When was the most recent one?'
            : 'One of your roles has no dates beside it, and that is five points an ATS takes off for a history it cannot place in time. When was it?',
          options: optionsFor('roledates', session),
          session,
        });
      }

      const plan = (jdSide && jdSide.ok) ? jdSide : null;
      if (offer.length &&
          !session.details.addProject && !declinedNow.includes('addproject')) {
        session.asked = 'addproject';
        session.planCache = { ok: true, plans: offer, missing: offer.map((p) => p.term) };
        const gaps = (plan && plan.missing) || [];
        return res.json({
          ok: true, kind: 'ask',
          reply: tailorHouse
            ? `${companyProfiles.noteFor(session.pickedJob.company, tailorRole)} These are the ${offer.length} pieces of work that shows${gaps.length ? `, starting with what this posting names — ${gaps.slice(0, 3).join(', ')}` : ''}. Pick as many as you want to build. Each goes on the page marked as planned, with its steps, and stays out of the PDF until you have actually built it.`
            : `This posting asks for ${gaps.slice(0, 3).join(', ')} and your page cannot prove ${gaps.length === 1 ? 'it' : 'them'} yet. Pick as many as you want to build. Each goes on the page marked as planned, with the steps — and stays out of the PDF until you have actually built it.`,
          options: {
            /* Several, because one project rarely closes a gap and somebody
               planning a month of work should be able to plan all of it. */
            multi: true,
            options: offer.map((p) => ({
              label: `${p.build} (${p.term})`,
              note: `about ${p.hours}`,
              value: p.term,
            })),
            other: { label: 'None — keep only what I have built', value: 'skip' },
          },
          session,
        });
      }
      session.tailorPicked = true;
    }

    /*
     * You cannot tailor a document that does not exist.
     *
     * The guard used to be "no resume AND no details", so the moment somebody
     * answered one interview question it fell through and tailored an empty
     * page: a new user picked a stripe opening, was interviewed, and got back
     * a converted resume scoring 18 with a gap table about a document that had
     * never been written. Build first, then tailor — the build finishes
     * against the posting they picked, which is the order they asked for.
     */
    if (session.command === 'tailor' && !session.resumeText.trim()) {
      session.command = 'build';
      const q = nextQuestion(session).question;
      if (q) return ask(q.field, q.question);
    }

    if (session.command === 'tailor') {
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
      /*
       * Nothing here is typed. The tailor asks two things and both are lists.
       *
       * It used to ask for an email, a date range, a metric for a bullet, and
       * then "the JD asks for X and your resume shows no evidence — have you
       * actually used any? Name where, one line each." Every one of those is
       * an essay question put to somebody who came here because writing the
       * resume was the hard part. A recording caught the last one asking a
       * student to prove they had used "GOOGLE".
       *
       * What the rewrite genuinely cannot decide for them is which work to
       * lead with and which skills to put first — and both of those are picks
       * from what is already on their page. Those are asked, below, as
       * checkboxes. Nothing else is.
       */
      const source = session.resumeText.trim() || Object.entries(session.details)
        .map(([k, v]) => `${k}: ${v}`).join('\n');
      const packet = atsEngine.rewriteResume(source, {
        target: session.target,
        jd: session.jd,
        mode: 'CONVERT',
        /* Their pick leads, ahead of the keyword count. */
        leadSkill: session.details.leadSkill,
      });

      /*
       * Tailoring runs the whole ladder, not just the conversion.
       *
       * This was the "it never raises my score" complaint, and it was exactly
       * true. Tailoring called the CONVERT rewrite and stopped there, so it
       * collected the structural points once and nothing after: upload at 86,
       * tailor for Amazon 87, then OpenAI 87, Adobe 87, Netflix 87 — the same
       * number forever, because a converted page converts to itself.
       *
       * Meanwhile the points were sitting in plain sight. On that very page:
       * verbs 7/12, because one bullet of two opened with a noun. Fronting a
       * verb is a wording change on the student's own sentence — no fact
       * touched, no claim added — and it was worth five points that only the
       * "make it 98" path ever bothered to collect.
       *
       * So the tailor now runs the same honest levers raise does, keeps the
       * best-scoring version, and can only move the number upwards.
       */
      const convertedScore = scanResume(packet.resume, session.scoreTarget).score;
      /*
       * One implementation, called from both places.
       *
       * This block and the from-scratch branch were the same sequence
       * written twice, which is how they drifted: the climb, the floor and
       * the self-check lived here, and a resume built from scratch got none
       * of them and shipped at 56. Whatever the agent does for an uploaded
       * page it now does for a built one, because it is the same function.
       */
      tailorClimb(packet, session);

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
      /*
       * A new posting is a new answer, even when the page comes out the same.
       *
       * Somebody tailored for a Data Analyst role, then for an Analytics
       * Engineer role, and was told "this page is already converted, nothing
       * was changed" — true of the document and false of the question. The
       * two postings want different things; the map, the match, the not-
       * claimed list and the work worth building are all different, and that
       * is what they came back for. The guard exists to stop the identical
       * reply to the identical request, so it now checks the request too.
       */
      const sameAsLast = session.shipped &&
        String(session.shipped.jd || '') === String(session.jd || '') &&
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

        /*
         * The metric question is gone, and it took a loop with it.
         *
         * "Give me one real number for your strongest bullet" is a typed
         * answer, which the brief does not allow, and it was the last one
         * hiding in this branch. It also failed to terminate: a page that
         * converts to itself re-enters here on every turn, so the question
         * came back seventeen times in one walk-through — asked, answered,
         * asked again, which is the repeat bug in its oldest costume.
         *
         * Nothing is lost by removing it. The ceiling below already names the
         * three facts that would move the number, and the climb has already
         * added every project and skill that can move it without one.
         */

        if (session.convertedRepeats >= 3) {
          session.command = null;
          return res.json({
            ok: true, kind: 'help',
            reply: [
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
            'This page is already converted — re-running it produces the same document, so nothing was changed.',
            blocked.needFact
              ? `What is holding the score at ${blocked.report.score}/100 is a fact, not formatting: ${blocked.needFact.ask}. Give me that and I will use it.`
              : 'The remaining points need evidence your history does not show. I will not invent it.',
            packet.notClaimed.length ? `Not claimed: ${packet.notClaimed.slice(0, 6).join(', ')}.` : '',
          ].filter(Boolean).join('\n\n'),
          session,
        });
      }

      /* The score and the work to do, and nothing between them: the gap table
         and the conversion deltas were measurement stacked on top of the
         thing the student asked for. Both are still one command away. */
      return deliver(res, session, packet, null);
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
    /*
     * jobs — real openings, and the offer to tailor for one.
     *
     * This used to send people to a different portal, which meant uploading
     * the same resume twice and losing the thread. Finding an opening and
     * tailoring for it are one motion; the boards are already written, so
     * the hunt happens here and every row can start a tailor.
     */
    /*
     * The openings come before the blank page, not after it.
     *
     * "Build me a resume for a software engineer" is somebody who wants a job,
     * and the page is the means. Interviewing them for twenty minutes and then
     * handing over a document leaves them exactly where they started: a
     * resume aimed at nothing in particular. The postings for the title they
     * just named are one search away, so they come first — and the row they
     * open is what the page is then built and tailored against.
     */
    const buildNeedsJobs = session.command === 'build' &&
      !session.resumeText.trim() && !session.pickedJob &&
      Boolean(session.target) && !session.jobsShownForBuild;

    if (session.command === 'jobs' || buildNeedsJobs) {
      const source = session.resumeText.trim() || (session.shipped && session.shipped.text) || '';
      if (buildNeedsJobs) {
        session.jobsShownForBuild = true;
        session.jobRole = session.jobRole || session.target;
      }
      /*
       * A title is enough to search with, and the title can be in the ask.
       *
       * "find me jobs for a backend engineer" came back with "attach your
       * resume first" — a dead end put in front of somebody who had just
       * named the role. A page makes the ranking better and was never
       * required to run a search. So the sentence is read for a role, and if
       * there is still none the position picker asks for it, which is a list
       * to choose from rather than a document to go and find.
       */
      if (!session.jobRole) {
        const spoken = roleFromHunt(low);
        if (spoken) session.jobRole = spoken;
      }

      /* Which role, before searching for it. Guessing the target from the
         resume is right for somebody staying in their lane and wrong for
         everybody else, and a person browsing openings is choosing between
         known titles rather than composing one. */
      /*
       * One question, and it is a pick.
       *
       * Finding openings is the whole job of this seat — the student is here
       * because they do not know what is out there, so asking them to supply
       * a job title is asking them for the answer. The only thing the search
       * genuinely cannot know is which position they are aiming at, so that
       * is asked, from a list, once.
       */
      /*
       * The resume already says what they are.
       *
       * "Which position are you applying for?" is a fair question to somebody
       * changing lane and a strange one to somebody who has just uploaded a
       * page headed Backend Engineer — they told us on the first turn and
       * were asked again on the second. When the page states a title, that is
       * what gets searched, and the list itself is the place to change lane:
       * the openings come back for that title and every row can start a
       * tailor for a different one.
       */
      if (!session.jobRole) {
        const stated = (atsEngine.factLedger(source).title || '').trim();
        if (stated) session.jobRole = stated;
      }
      if (!session.jobRole && !(session.declined || []).includes('jobrole')) {
        session.command = 'jobs';
        return ask('jobrole', 'Which position are you applying for?');
      }

      let found = [];
      try {
        found = await portalJobs(source, session.jobRole || session.target || '');
      } catch (e) {
        /* A silent board must not strand somebody with no page at all — they
           came to build one, so the interview starts and the list can wait. */
        if (buildNeedsJobs) {
          session.command = 'build';
          const q = nextQuestion(session).question;
          if (q) return ask(q.field, q.question, 'The job boards did not answer just now, so let us build the page first — say "show me the openings" whenever you want to try the search again.');
        }
        session.command = null;
        return res.json({
          ok: true, kind: 'help',
          reply: 'The job boards did not answer just now. Try again in a moment — I will not invent openings to fill the gap.',
          session,
        });
      }

      /*
       * The companies everybody is aiming at, on the end of every list.
       *
       * The boards return whoever is advertising today, which is rarely the
       * handful of employers a student actually has in mind. These are not
       * openings and are not presented as any — they are a target to tailor
       * against, so somebody can see their page rewritten for Google before
       * a Google posting ever appears.
       *
       * The blurb is for the reader and nothing else: given to the tailor as
       * a job description, its own words became required terms and a page
       * came back needing to evidence "Tailoring". A target has no posting
       * behind it — it has a role, and that is all there is to match.
       */
      /*
       * Ten names was ten names for one kind of student.
       *
       * Google, Meta, Amazon and the rest are the right targets for a backend
       * engineer and irrelevant to an actuary, a supply-chain analyst or a
       * process engineer — who were being shown a wall of companies that do
       * not hire their title. The list is now large-cap employers across the
       * S&P 500 and the Nifty 50, tagged by domain, with the domains that fit
       * the role first and the rest behind so aiming outside a sector stays
       * one click away.
       */
      const role = session.jobRole || session.target || 'Engineer';
      /*
       * All of them, not the first thirty.
       *
       * The cap was thirty because a long list reads badly, and it meant the
       * roster stopped at the sectors nearest the student's title — so a
       * backend engineer never saw the banks, the semiconductor firms or the
       * Indian product companies at all. Whoever is advertising today is the
       * top of the list and the whole roster follows it, ordered by how well
       * each employer fits the role. It is a list to scroll, and scrolling is
       * cheaper than an employer being invisible.
       */
      const aspirational = aspirationalCompanies
        .aspirationalFor(role, aspirationalCompanies.COMPANIES.length)
        .map(({ name: company }) => ({
        title: role,
        company,
        location: 'Global · wherever they hire this role',
        url: '',
        aspirational: true,
        blurb: `${company} hires ${role.toLowerCase()}s continuously. This is not a posting — it is a target. Tailoring against it rewrites your page for the bar they screen at, so it is ready the day one opens.`,
        description: '',
        tags: [],
      }));

      session.command = null;
      session.jobs = [...found, ...aspirational];
      if (!found.length) {
        if (buildNeedsJobs) {
          session.command = 'build';
          const q = nextQuestion(session).question;
          if (q) return ask(q.field, q.question, `No live listing came back for ${role} just now, so let us build the page first — the targets are still there to aim at, and "show me the openings" retries the search.`);
        }
        return res.json({
          ok: true, kind: 'help',
          reply: `Nothing came back for ${session.jobRole || 'that role'} with a real listing behind it. Try a nearby title and I will search again — a row with nowhere to apply is not a result.`,
          session,
        });
      }

      return res.json({
        ok: true,
        kind: 'help',
        /* The whole list, not the boards' half of it. */
        jobs: session.jobs,
        reply: [
          buildNeedsJobs
            ? `${found.length} opening${found.length === 1 ? '' : 's'} for ${role} before we write a word — a page aimed at a real posting beats one aimed at nothing in particular.`
            : `${found.length} opening${found.length === 1 ? '' : 's'} for ${role}, matched to what your resume can prove.`,
          '',
          ...found.slice(0, 8).map((j, i) => `${i + 1}. **${j.title}** — ${j.company}${j.location ? ` · ${j.location}` : ''}`),
          '',
          `And ${aspirational.length} worth aiming at: ${aspirational.slice(0, 12).map((j) => j.company).join(', ')} — and ${aspirational.length - 12} more below. Not postings, targets. Tailoring against one rewrites your page for the bar they screen at, so it is ready the day something opens.`,
          '',
          buildNeedsJobs
            ? 'Open the one you want and I will build the page for it — its projects and its skills, the ones that employer screens on.'
            : 'Open any of them to read the role. Tailor resume is at the top.',
        ].join('\n'),
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
      /*
       * A letter for the job we just tailored for asks nothing it already
       * knows: the position, the employer and the market are on the screen
       * the offer was made from, and asking again is the agent forgetting
       * what it just did.
       */
      /*
       * Prefilled per job, not once per session.
       *
       * The latch was a plain boolean and the fields were ||-guarded, so the
       * first letter's employer stuck: somebody tailored for stripe, wrote the
       * letter, tailored for airbnb, asked for a second letter — and it opened
       * "Dear Hiring Team at stripe". Sending that is worse than sending
       * nothing. When the row changes, the letter's employer changes with it.
       */
      const jobKey = session.pickedJob
        ? `${session.pickedJob.company}|${session.pickedJob.title}` : null;
      if (session.pickedJob && session.coverPrefilledFor !== jobKey) {
        session.coverPrefilledFor = jobKey;
        const j = session.pickedJob;
        session.details.company = j.company;
        session.details.position = j.title;
        session.details.role = j.title;
        if (j.location) session.details.location = j.location;
        session.target = session.target || j.title;
      }

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

    /*
     * parser — what an ATS actually pulls out of the file.
     *
     * Every other view is an opinion. This one is a fact, and a student who
     * sees their phone number extracted broken stops arguing with the score
     * and fixes the document.
     */
    if (session.command === 'parser') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach the file itself — this shows what a parser gets out of it.');
      const v = parserView.parserView(session.resumeText);
      session.command = null;
      const mark = { high: '✓', low: '~', none: '✗' };
      return res.json({
        ok: true, kind: 'help',
        reply: [
          v.verdict,
          `${v.summary.extracted}/${v.summary.of} fields came out.`,
          '',
          '| Field | Extracted | Confidence | Why |',
          '|---|---|---|---|',
          ...v.fields.map((f) => `| ${f.name} | ${(f.value || '—').toString().slice(0, 46)} | ${mark[f.confidence]} ${f.confidence} | ${f.why} |`),
          '',
          v.roles.length ? 'Roles as the parser splits them:' : '',
          ...v.roles.map((r) => `· ${r.header.slice(0, 70)} — ${r.bullets} bullet${r.bullets === 1 ? '' : 's'}${r.warning ? ` · ${r.warning}` : ''}`),
          v.hazards.length ? '\nLayout faults:' : '',
          ...v.hazards.map((h) => `· ${h.what} — ${h.why}`),
          '',
          v.caveat,
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /* quickcheck — the ten-second read, before the detailed score. */
    if (session.command === 'quickcheck') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume first.');
      const q = library.quickCheck(session.resumeText);
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          `${q.passed}/${q.of} — ${q.verdict}`,
          '',
          ...q.checks.map((c) => `${c.pass ? '✓' : '✗'} ${c.label} — ${c.note}`),
        ].join('\n'),
        session,
      });
    }

    /* versions — the master and every tailored derivative of it. */
    if (session.command === 'versions') {
      const list = library.listVersions(session.library);
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          list.hasMaster ? 'Master resume on file.' : 'No master yet — upload one and every tailoring keeps it intact.',
          '',
          list.versions.length ? '| Version | Company | Role | Score | Not claimed |' : 'No tailored versions yet. Tailor against a posting and it is saved here.',
          list.versions.length ? '|---|---|---|---|---|' : '',
          ...list.versions.map((v) =>
            `| ${v.id} | ${v.company || '—'} | ${v.role || '—'} | ${v.score == null ? '—' : `${v.score}/100`} | ${v.notClaimed} |`),
          '',
          list.versions.length ? 'Each version keeps the note it shipped with, so opening one later shows what it did not claim.' : '',
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /*
     * bullets — the best lines this person has ever written, for this job.
     *
     * Somebody who has tailored four times has written the same achievement
     * four ways, and the best phrasing is rarely the newest. Ranking is by
     * the posting's own hard terms: a bullet that names the required tool AND
     * carries a figure is the first line of the page, and knowing that needs
     * no model.
     */
    if (session.command === 'bullets') {
      const lib = library.setMaster(session.library, session.resumeText || '');
      if (!session.jd) {
        const all = library.bulletLibrary(lib);
        session.command = null;
        return res.json({
          ok: true, kind: 'help',
          reply: [
            `${all.length} bullet${all.length === 1 ? '' : 's'} on file across your master and every version you have tailored.`,
            '',
            ...all.slice(0, 12).map((b) => `${b.hasNumber ? '#' : '·'} ${b.text.slice(0, 110)}`),
            '',
            'Paste a job description and I will rank these against it.',
          ].join('\n'),
          session,
        });
      }
      const ranked = library.rankForJd(lib, session.jd, 8);
      session.command = null;
      return res.json({
        ok: true, kind: 'help',
        reply: [
          ranked.length
            ? `Your ${ranked.length} most relevant lines for this posting, best first.`
            : 'None of your bullets name anything this posting asks for. That gap is facts, not wording.',
          '',
          ...ranked.map((b, i) => `${i + 1}. ${b.text.slice(0, 120)}\n   matches: ${b.hits.join(', ') || '—'}${b.hasNumber ? ' · carries a number' : ' · no number'}`),
          '',
          ranked.length ? 'Lead the tailored page with these. Nothing was rewritten — they are your own lines, reordered.' : '',
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /*
     * score5 — the same measurement, in the five parts it is made of.
     *
     * One number tells somebody they are at 80 and nothing about what to do
     * next. Split the way the work splits, it says which of them is theirs to
     * fix and which is ours.
     */
    if (session.command === 'score5') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume to score.');
      const s = atsEngine.score5(session.resumeText, { target: session.target, jd: session.jd });
      session.command = null;
      const bar = (v) => (v === null ? '—'.padEnd(10) : '█'.repeat(Math.round(v / 10)).padEnd(10, '░'));
      return res.json({
        ok: true, kind: 'help',
        reply: [
          `Overall ${s.overall}/${s.of} · recruiter-scan ${s.recruiter}/100`,
          s.scaledFromPartial
            ? 'No posting supplied, so the keyword bar was never measured — this is the rest of the rubric, rescaled. Paste a job description for the real number.'
            : '',
          '',
          ...s.bars.map((b) => `${b.name.padEnd(18)} ${bar(b.value)} ${b.value === null ? 'N/A' : `${b.value}/100`}\n${' '.repeat(19)}${b.why}`),
          '',
          s.fixes.length ? 'Worst first:' : 'Nothing left that formatting can move.',
          ...s.fixes.map((f, i) => `${i + 1}. [${f.bar}] ${f.fix}`),
          '',
          s.caveat,
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /*
     * plan — the skills the posting wants, and how to actually get them.
     *
     * The version of this feature that writes the missing skills onto the
     * page and teaches them afterwards trades a document somebody can defend
     * for one they cannot: the first interviewer asks about the project and
     * the conversation ends there, having cost them the interview rather
     * than won them the line. The gap is real, so it is reported; the plan is
     * real, so it is buildable in a weekend.
     */
    if (session.command === 'plan') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume first.');
      if (!session.jd) return ask('jd', 'Paste the job description — the plan is built from what this posting asks for and your page cannot prove.');
      const plan = skillPlan.planFor(session.resumeText, session.jd, { limit: 4 });
      session.command = null;
      if (!plan.ok) return res.json({ ok: true, kind: 'help', reply: plan.reason, session });
      return res.json({
        ok: true, kind: 'help',
        reply: [
          plan.plans.length
            ? `${plan.missing.length} term${plan.missing.length === 1 ? '' : 's'} this posting wants that your page cannot prove. Here is how to make ${plan.plans.length === 1 ? 'the first one' : `the top ${plan.plans.length}`} true.`
            : 'Your page already evidences everything this posting names. Nothing to build.',
          plan.weakNote || '',
          ...plan.plans.flatMap((p) => [
            '',
            `**${p.term}${p.essential ? ' — essential for this role' : ''}**`,
            `Build: ${p.build} · about ${p.hours}`,
            ...p.steps.map((s, i) => `${i + 1}. ${s}`),
            `Then it earns this line: "${p.bulletAfter}" — fill the blanks from what it actually did.`,
            `Be ready for: ${p.defend}`,
          ]),
          '',
          plan.rule,
        ].filter(Boolean).join('\n'),
        session,
      });
    }

    /*
     * plan-add — the planned projects, onto the draft.
     *
     * A list of things to build is a to-do list; the same list written as
     * the projects section it will become is a target you can see, which is
     * what was asked for. What makes it safe rather than a fabrication is
     * everything around it: its own heading, a marker on every line, blanks
     * where the numbers will go, and an export that refuses to produce a PDF
     * while any of it is still unbuilt.
     */
    if (session.command === 'plan-add') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume first.');
      if (!session.jd) return ask('jd', 'Paste the job description — the projects are chosen from what it asks for.');
      const plan = skillPlan.planFor(session.resumeText, session.jd, { limit: 4 });
      session.command = null;
      if (!plan.ok || !plan.plans.length) {
        return res.json({ ok: true, kind: 'help', reply: 'Your page already evidences everything this posting names — there is nothing to plan.', session });
      }
      const entries = skillPlan.projectEntries(plan);
      session.resumeText = skillPlan.withPlannedProjects(session.resumeText, entries);
      session.plannedCount = entries.length;

      return res.json({
        ok: true,
        kind: 'build',
        text: session.resumeText,
        report: scanResume(session.resumeText, session.scoreTarget),
        details: session.details,
        reply: [
          `${entries.length} project${entries.length === 1 ? '' : 's'} added under their own heading, each marked "${skillPlan.PLANNED}" with the numbers left blank.`,
          '',
          '**Before you send this to anyone, read this.** These projects do not exist yet. The page will not export to PDF while they are on it, and that is on purpose — a project you cannot walk through fails the first question an interviewer asks about it.',
          '',
          'Here is how to build each one. When one is done, say "I built it" and I will ask you for the real numbers and move it into your actual Projects section.',
          ...entries.flatMap((e) => [
            '',
            `**${e.term} — ${e.name}** · about ${e.hours}`,
            ...e.steps.map((s, i) => `${i + 1}. ${s}`),
            `Be ready for: ${e.defend}`,
          ]),
          '',
          'Or say "apply with what I have" and I will take them back off and export the honest version now.',
        ].join('\n'),
        session,
      });
    }

    /* plan-built — a planned project becomes a real one, with real numbers. */
    if (session.command === 'plan-built') {
      const pending = skillPlan.plannedLines(session.resumeText);
      if (!pending.length) {
        session.command = null;
        return res.json({ ok: true, kind: 'help', reply: 'Nothing is marked as planned right now — your page is all real work.', session });
      }
      session.command = 'plan-built';
      return ask('builtproof',
        `Good. Which one, and what did it actually do? Give me the line as it should read, with the real numbers in it — for example "Built a Kafka order pipeline handling 400 messages a minute, verified by killing consumers mid-run".\n\nStill planned: ${pending.slice(0, 4).map((p) => p.split('—')[0].trim()).join(', ')}.`);
    }

    /* plan-remove — apply now, with what actually exists. */
    if (session.command === 'plan-remove') {
      const before = skillPlan.plannedLines(session.resumeText).length;
      session.resumeText = skillPlan.withoutPlanned(session.resumeText);
      session.plannedCount = 0;
      session.command = null;
      return res.json({
        ok: true,
        kind: 'build',
        text: session.resumeText,
        report: scanResume(session.resumeText, session.scoreTarget),
        details: session.details,
        reply: [
          before
            ? `${before} planned project${before === 1 ? '' : 's'} taken off. This is the honest version of your page and it exports now.`
            : 'Nothing was marked as planned. This page already exports.',
          'The build steps are still yours — say "how do I get these skills" whenever you want them back.',
        ].join('\n\n'),
        session,
      });
    }

    /* keywords — present, weak or missing, with where each one belongs. */
    if (session.command === 'keywords') {
      if (!session.resumeText.trim()) return ask('resume', 'Attach or paste the resume first.');
      if (!session.jd) return ask('jd', 'Paste the job description — keywords are only real against a posting.');
      const led = atsEngine.factLedger(session.resumeText);
      const map = atsEngine.jdMap(session.resumeText, led, session.jd);
      session.command = null;
      if (!map) {
        return res.json({ ok: true, kind: 'help', reply: 'That posting names no hard terms I can measure against. Paste the requirements section.', session });
      }
      const state = { evidenced: 'present', 'listed only': 'weak', 'not claimed': 'missing' };
      const priority = (r) => (r.kind === 'must' ? (r.status === 'not claimed' ? 'high' : 'medium') : 'low');
      return res.json({
        ok: true, kind: 'help',
        reply: [
          `${map.evidenced}/${map.rows.length} of the posting's terms are evidenced${map.listedOnly ? `, ${map.listedOnly} claimed with nothing behind them` : ''}.`,
          '',
          '| Term | State | Priority | Where it belongs |',
          '|---|---|---|---|',
          ...map.rows.slice(0, 16).map((r) => {
            const where = r.status === 'evidenced' ? r.where
              : r.status === 'listed only' ? 'a bullet, not the skills line'
                : r.kind === 'must' ? 'a bullet — only if you have used it' : 'optional';
            return `| ${r.term} | ${state[r.status]} | ${priority(r)} | ${where} |`;
          }),
          '',
          'Nothing is added for you. A keyword you cannot defend in the room is worse than a missing one.',
        ].join('\n'),
        session,
      });
    }

    /*
     * interview — questions from THIS resume, one at a time.
     *
     * Generic STAR prompts rehearse nothing. The questions worth practising
     * are the ones a real interviewer would ask about this page: the bullet
     * with the number in it, the skill listed with nothing behind it, the
     * term the posting wants that the page cannot prove.
     */
    if (session.command === 'interview') {
      const source = session.resumeText.trim() || (session.shipped && session.shipped.text) || '';
      if (!source) return ask('resume', 'Attach or paste the resume — the questions come out of it, not from a generic list.');

      if (!session.interview) {
        const built = mockInterview.questionsFor(source, {
          role: session.target || undefined, jd: session.jd, limit: 8,
        });
        session.interview = { role: built.role, questions: built.questions, answers: [], at: 0 };
      }
      const iv = session.interview;
      /* The answer itself was consumed on the way in, by consumeAnswer. */
      if (iv.at >= iv.questions.length) {
        session.command = 'interview-review';
      } else {
        const q = iv.questions[iv.at];
        session.command = 'interview';
        return ask('answer', q.prompt,
          `Question ${iv.at + 1} of ${iv.questions.length} · ${iv.role}. Answer as you would out loud — about 45 seconds. Say "review" when you want the report.`);
      }
    }

    /* interview-review — what the words show, and nothing they do not. */
    if (session.command === 'interview-review') {
      const iv = session.interview;
      if (!iv || !iv.answers.length) {
        session.command = null;
        return res.json({ ok: true, kind: 'help', reply: 'No interview to review yet. Say "mock interview" and I will ask the first question.', session });
      }
      const report = mockInterview.scoreSession(iv.answers);
      const better = mockInterview.betterAnswers(session.resumeText || (session.shipped && session.shipped.text) || '', 3);
      session.command = null;
      session.interview = null;

      return res.json({
        ok: true, kind: 'help',
        reply: [
          `Overall ${report.score}/${report.of} — ${report.verdict}`,
          report.detail || '',
          '',
          report.tone ? `Clarity: ${report.tone.clarity} — ${report.tone.clarityWhy}` : '',
          report.tone ? `Confidence: ${report.tone.confidence} — ${report.tone.confidenceWhy}` : '',
          report.tone ? `Enthusiasm: ${report.tone.enthusiasm} — ${report.tone.enthusiasmWhy}` : '',
          report.pace ? `Pace: ${report.pace.estimate}. ${report.pace.note}` : '',
          '',
          report.strengths.length ? `What worked: ${report.strengths.join(' ')}` : '',
          report.fixes.length ? 'What to fix, worst first:' : '',
          ...report.fixes.map((f, i) => `${i + 1}. ${f}`),
          better.length ? '\nThree answers to rehearse, built only from what your resume already says:' : '',
          ...better.flatMap((b) => [`\n"${b.from}"`, ...b.scaffold.map((s) => `  · ${s}`)]),
          '',
          report.tone ? report.tone.caveat : '',
        ].filter(Boolean).join('\n'),
        session,
      });
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

      /*
       * A page built from scratch is not the end of the errand.
       *
       * Somebody who says "build me a resume for a software engineer" wants a
       * job, and the page is the means. Left here they had a document and no
       * next move — and the openings for the exact title they just named were
       * one search away. The title carries over so the list needs no question,
       * and every row on it can start a tailor for the real posting.
       */
      if (!session.jobRole && session.target) session.jobRole = session.target;

      /*
       * Built for a row they already opened, so it lands tailored.
       *
       * The order the student asked for runs openings → pick → page, and
       * stopping at a generic page after they had already chosen the job
       * throws the choice away. The posting is on the session, so the build
       * finishes against it and the reply names what that employer screens on
       * — the projects worth building come from the same profile.
       */
      if (session.pickedJob && session.jd) {
        const j = session.pickedJob;
        const packet = atsEngine.rewriteResume(built.text, {
          target: session.target || j.title,
          jd: session.jd,
          mode: 'CONVERT',
        });
        session.command = 'tailor';
        /* The same climb an uploaded resume gets — this branch used to
           convert the page and stop, which is why building from scratch
           delivered 56 where uploading delivered 96. */
        tailorClimb(packet, session);
        session.resumeText = packet.resume || built.text;
        return deliver(res, session, packet,
          `Built and tailored for ${j.title} at ${j.company}. ${companyProfiles.noteFor(j.company, session.target || j.title)}`);
      }

      return deliver(res, session, built, session.jobRole
        ? `Built for ${session.jobRole}. Say "show me the openings" and I will list who is hiring for it right now, plus the large employers worth aiming at — open any row to tailor this page for it.`
        : null);
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
    /*
     * A posting pasted here is a posting, not a line of your history.
     *
     * "Product Manager. Must have: SQL, analytics, roadmapping." arrived
     * after a delivery and was filed under Experience — the student's resume
     * grew a bullet claiming the job advert they had just pasted. Anything
     * naming requirements is the job, and belongs in the JD.
     */
    if (session.resumeText.trim() && /\b(must have|requirements?|responsibilities|nice to have|qualifications|we are (looking|seeking))\b/i.test(msg)) {
      session.jd = msg.trim();
      return res.json({
        ok: true, kind: 'help',
        reply: 'Read that as the job description. Say "tailor" to convert your page against it, or "missing keywords" for the gap table.',
        session,
      });
    }

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
    /* The stack goes to the server log. A 500 that says only "something went
       wrong" is unfixable from the outside, and this handler is 2,000 lines
       of branches — the line number is the whole diagnosis. */
    console.error('[resume-agent] chat failed:', e && e.stack ? e.stack : e);
    res.status(500).json({ ok: false, error: 'Something went wrong reading that. Paste the text instead and I will scan it.' });
  }
});

module.exports = router;
module.exports.scanResume = scanResume;
module.exports.raiseToTarget = raiseToTarget;
module.exports.buildResume = buildResume;
module.exports.resumePdfBuffer = resumePdfBuffer;
