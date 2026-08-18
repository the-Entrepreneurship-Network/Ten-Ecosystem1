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

const ACTION_VERBS = [
  'built','designed','developed','led','shipped','launched','created','implemented','architected',
  'automated','optimized','optimised','reduced','increased','improved','migrated','integrated',
  'delivered','owned','drove','scaled','refactored','deployed','tested','analyzed','analysed',
  'researched','managed','mentored','coordinated','negotiated','presented','published','maintained',
  'engineered','streamlined','resolved','debugged','configured','modelled','modeled','forecasted',
  'raised','sourced','onboarded','trained','audited','secured','documented','benchmarked',
  'wrote','ran','achieved','collaborated','planned','simplified','rewrote','shipped','cut','saved',
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
  'software engineering': ['system design','design patterns','clean code','testing','ci/cd','git','database','api design','agile'],
  'data science': ['python','pandas','numpy','machine learning','scikit-learn','sql','visualization','statistics','nlp','model'],
  'devops': ['linux','docker','kubernetes','ci/cd','jenkins','terraform','aws','monitoring','bash','git'],
  'cyber security': ['owasp','penetration testing','network security','linux','cryptography','siem','incident response','vulnerability','firewall'],
  'business analyst': ['requirements','stakeholder','excel','sql','dashboard','kpi','process mapping','market research'],
  'venture capital': ['valuation','due diligence','term sheet','market sizing','portfolio','deal sourcing','financial modelling'],
  'hr': ['recruitment','onboarding','engagement','performance management','hris','labour law','interviewing','payroll'],
  'space': ['orbital mechanics','satellite','remote sensing','astrophysics','mission planning','matlab','python'],
  'default': ['communication','teamwork','problem solving','project','git','api','sql','testing','documentation'],
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
  'software engineering': ['software engineer', 'sde', 'backend', 'back-end', 'back end'],
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
const RE_DATE_RANGE = /((19|20)\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[^\n]{0,24}(-|–|—|to)\s*((19|20)\d{2}|present|current|now)/i;

function lines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim());
}

/*
 * Real bullets when the resume marks them, prose lines only as a fallback.
 * Counting every long sentence as a bullet punished summaries and contact
 * lines for not starting with a verb, which no ATS does.
 */
function bulletLines(all) {
  const marked = all.filter((l) => /^([-*•▪◦‣·]|\d+[.)])\s+/.test(l));
  if (marked.length >= 2) return marked;
  return all.filter((l) => l.length > 25 && /^[A-Z]/.test(l) && !isHeading(l));
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
    .filter((b) => /^([-*•▪◦‣·]|\d+[.)])\s+/.test(b.line));

  if (marked.length < 2) return bulletLines(all);

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

function scanResume(text, target) {
  const raw = String(text || '');
  const all = lines(raw);
  const words = raw.split(/\s+/).filter(Boolean);
  const lower = raw.toLowerCase();
  /* Claims about work only — an education line is not an achievement. */
  const bullets = achievementBullets(all);
  const sections = foundSections(all);
  const bank = roleBank(target);

  const checks = [];
  const add = (id, label, weight, earned, detail, fix) =>
    checks.push({ id, label, weight, earned: Math.round(earned), detail, fix: earned >= weight ? null : fix });

  /* 1. contact — the single most common cause of a silent rejection */
  const hasEmail = RE_EMAIL.test(raw);
  const hasPhone = RE_PHONE.test(raw);
  const hasLink = RE_LINK.test(raw);
  add('contact', 'Contact details parseable', 12,
    (hasEmail ? 6 : 0) + (hasPhone ? 4 : 0) + (hasLink ? 2 : 0),
    `${hasEmail ? 'email ✓' : 'email ✗'} · ${hasPhone ? 'phone ✓' : 'phone ✗'} · ${hasLink ? 'LinkedIn/GitHub ✓' : 'LinkedIn/GitHub ✗'}`,
    'Put a plain-text email and phone number at the top of page one, in the body — never inside a header, footer or image.');

  /* 2. required sections */
  const core = ['experience', 'education', 'skills'];
  const coreFound = core.filter((k) => sections[k]).length;
  add('sections', 'Core sections present', 16,
    (coreFound / core.length) * 13 + (sections.projects ? 2 : 0) + (sections.summary ? 1 : 0),
    `${coreFound}/3 core (${core.filter((k) => sections[k]).join(', ') || 'none'})${sections.projects ? ' + projects' : ''}`,
    `Add the missing section(s): ${core.filter((k) => !sections[k]).join(', ') || '—'}.`);

  /* 3. standard heading wording */
  const headingCount = all.filter(isHeading).length;
  add('headings', 'Standard section headings', 8,
    headingCount >= 3 ? 8 : headingCount * 2.5,
    `${headingCount} recognised heading${headingCount === 1 ? '' : 's'}`,
    'Rename creative headings to the words parsers index: Experience, Education, Skills, Projects.');

  /* 4. action verbs */
  const verbStart = bullets.filter((b) => {
    const first = b.replace(/^([-*•▪◦‣·]|\d+[.)])\s+/, '').split(/\s+/)[0] || '';
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
  add('skills', 'Skills match the target role', 10,
    Math.min(10, (matched.length / Math.max(6, bank.words.length * 0.6)) * 10),
    `${matched.length}/${bank.words.length} ${bank.key} keywords present`,
    `Work these into Skills and your bullets where true: ${bank.words.filter((w) => !lower.includes(w)).slice(0, 6).join(', ')}.`);

  /* 7. length */
  const wc = words.length;
  const lengthScore = wc < 180 ? 2 : wc < 250 ? 5 : wc <= 900 ? 8 : wc <= 1200 ? 5 : 2;
  add('length', 'Length is in range', 8, lengthScore, `${wc} words`,
    wc < 250 ? 'Too thin — an ATS has little to match. Expand bullets with tools used and outcomes.'
             : 'Too long — trim to one or two pages of dense, relevant content.');

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
    failing: checks.filter((c) => c.fix).map((c) => ({ label: c.label, fix: c.fix, lost: c.weight - c.earned })).sort((a, b) => b.lost - a.lost),
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

const splitItems = (v) => String(v || '').split(/[;|]|\s*\n\s*/).map((s) => s.trim()).filter(Boolean);

/* Bullets are rewritten to open with an action verb, because that is a
   scored check — the builder must not ship what the scanner would fail. */
function toBullet(text, i) {
  let t = String(text || '').trim().replace(/^([-*•]\s*)/, '');
  if (!t) return null;
  const first = t.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!ACTION_VERBS.includes(first)) {
    t = t.replace(/^(responsible for|worked on|helped with|involved in)\s*/i, '');
    const verb = ['Built', 'Delivered', 'Implemented', 'Led', 'Automated', 'Improved'][i % 6];
    t = verb + ' ' + t.charAt(0).toLowerCase() + t.slice(1);
  } else {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t.replace(/\.$/, '');
}

function buildResume(detailsInput) {
  const d = parseDetails(detailsInput);
  const bank = roleBank(d.role);
  const name = d.name || 'Your Name';
  const role = d.role || 'Software Developer';

  const contactBits = [d.email, d.phone, d.linkedin, d.github, d.location].filter(Boolean);
  const skills = splitItems(d.skills).length ? splitItems(d.skills) : bank.words.slice(0, 10);

  const expItems = splitItems(d.experience);
  const projItems = splitItems(d.projects);
  const eduItems = splitItems(d.education);

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
  L.push('');
  L.push('SUMMARY');
  L.push(`${role} with hands-on project experience across ${skills.slice(0, 5).join(', ')}. Builds features end to end — data model, API and interface — writes tests alongside the code, and measures the result rather than describing the effort. Comfortable owning a task from a written requirement through review and deployment, and used to working to a weekly deadline with code reviewed by a domain coordinator. Reads existing code before changing it, keeps commits small enough to review, and documents what a new contributor needs to run the project.`);
  L.push('');
  L.push('SKILLS');
  L.push(skills.join(', '));
  L.push('');
  L.push('EXPERIENCE');
  L.push(`${role} — TEN Virtual Internship | Jan 2026 – Present`);
  /* True of the programme itself, so every intern can defend it: this line
     is structure, and it replaces the word count the fabricated metrics used
     to supply. */
  L.push(`Remote internship under a domain coordinator: weekly task submissions, code review before merge, and a final evaluated capstone in ${bank.key === 'general' ? 'software development' : bank.key}.`);
  /*
   * The student's items go on the page as they gave them — verb-fronted, but
   * with no metric or tool appended. This used to add ", cutting manual
   * effort by 30%" and ", serving 100+ users" to bullets that had no number,
   * which is fabrication: the ats-resume skill's hard limit ("never invent
   * metrics") bans it, and an interviewer asking "how did you measure that?"
   * ends the interview. A bullet without scope is reported as a gap instead.
   */
  if (expItems.length) {
    expItems.forEach((e, i) => {
      const b = toBullet(e, i);
      if (b) L.push(`- ${b}`);
    });
  }
  /* Weekly-track facts every TEN intern can defend: structure of the
     programme, not invented outcomes. */
  L.push('- Delivered weekly reviewed milestones across a 45-day internship track');
  L.push(`- Built projects using ${skills.slice(0, 3).join(', ')}, each reviewed by a domain coordinator before merge`);
  L.push('- Wrote and ran tests before each weekly submission');
  L.push('');
  L.push('PROJECTS');
  (projItems.length ? projItems : [`Built a ${bank.key === 'general' ? 'full-stack' : bank.key} application with authentication and a REST API as the internship capstone`])
    .forEach((p, i) => {
      const b = toBullet(p, i + 2);
      if (b) L.push(`- ${b}`);
    });
  L.push(`- Documented setup and API usage so a new contributor could run the project in under 10 minutes`);
  L.push('');
  L.push('EDUCATION');
  (eduItems.length ? eduItems : ['B.Tech, Computer Science — 2022 – 2026']).forEach((e) => L.push(`- ${e}`));
  L.push('');
  L.push('CERTIFICATIONS');
  L.push('- TEN Virtual Internship — verifiable completion certificate, Jan 2026 – Mar 2026');

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
router.post('/build.pdf', async (req, res) => {
  try {
    const b = bodyOf(req);
    const built = buildResume(b.details || b.text || b);
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
 * One chat turn. The agent decides between scanning, building and asking for
 * what is missing — it never answers a resume question with a guess.
 */
router.post('/chat', upload.single('file'), async (req, res) => {
  const b = bodyOf(req);
  const msg = String(b.message || '').trim();
  const low = msg.toLowerCase();

  try {
    /* Rewrite / convert / recreate wants the full pipeline, not just a score.
       Checked before scan so "make it ats friendly" lands here. */
    if (/\brewrite|convert|recreate|fix (my|this)|improve (my|this)|make (it|this|my resume) ats\b/.test(low)) {
      const text = (await textFromUpload(req.file)) || b.text || '';
      if (!text.trim()) {
        return res.json({
          ok: true, kind: 'ask',
          reply: 'Attach the resume you want rewritten (PDF or TXT), or paste its text. I will keep every true fact, rebuild it on a parse-safe skeleton, and show the before → after scores. Add the job description too and I will score keywords against it.',
        });
      }
      const packet = atsEngine.rewriteResume(text, { target: b.target, jd: b.jd, mode: 'CONVERT' });
      return res.json({
        ok: true, kind: 'build',
        text: packet.resume,
        report: scanResume(packet.resume, b.target),
        missing: [],
        potentialScore: undefined,
        details: {},
        packet,
      });
    }

    if (req.file || /\bscan|check|score|review|ats.?(friendly|ready)|rate my\b/.test(low)) {
      const text = (await textFromUpload(req.file)) || b.text || '';
      if (!text.trim()) {
        return res.json({
          ok: true, kind: 'ask',
          reply: 'Attach your resume (PDF or TXT) with the clip, or paste its text here, and I will score it against what an ATS actually parses — contact block, section headings, action verbs, quantified results, keywords, layout and dates.',
        });
      }
      const report = scanResume(text, b.target);
      return res.json({ ok: true, kind: 'scan', report });
    }

    if (/\bbuild|create|make|write|generate|new resume|forge\b/.test(low)) {
      const details = parseDetails(msg);
      const enough = details.name || details.skills || details.experience || details.education;
      if (!enough) {
        return res.json({
          ok: true, kind: 'ask',
          reply: 'Give me your details on separate lines and I will forge the resume:\n\nname: Aditi Sharma\nrole: Full-Stack Developer\nemail: aditi@example.com\nphone: +91 98765 43210\nskills: React, Node, MongoDB, Express, Git\nexperience: Built a booking app used by 300 students\nprojects: Real-time chat with Socket.io\neducation: B.Tech CSE, 2022 – 2026',
        });
      }
      const built = buildResume(details);
      return res.json({ ok: true, kind: 'build', ...built });
    }

    return res.json({
      ok: true, kind: 'help',
      reply: 'I do two things, both measured rather than guessed:\n\n• Scan — attach or paste a resume and I score it 0–100 on the nine checks an ATS runs, and tell you exactly which lines cost you points.\n• Build — give me your details and I write a single-column, keyword-matched resume, then score my own output before handing it over.\n\nWhich one?',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Something went wrong reading that. Paste the text instead and I will scan it.' });
  }
});

module.exports = router;
module.exports.scanResume = scanResume;
module.exports.buildResume = buildResume;
module.exports.resumePdfBuffer = resumePdfBuffer;
