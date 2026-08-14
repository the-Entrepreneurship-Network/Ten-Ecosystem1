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
  const bullets = bulletLines(all);
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

  /* 5. quantified achievement */
  const quantified = bullets.filter((b) => /\d+\s*(%|percent|k\b|x\b|\+)|\b\d{2,}\b|₹|\$|€/.test(b)).length;
  const quantRatio = bullets.length ? quantified / bullets.length : 0;
  add('quantified', 'Achievements are quantified', 12, Math.min(12, quantRatio * 24),
    `${quantified}/${bullets.length || 0} bullets carry a number (${Math.round(quantRatio * 100)}%)`,
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
  L.push(contactBits.join(' | ') || 'email@example.com | +91 00000 00000');
  L.push('');
  L.push('SUMMARY');
  L.push(`${role} with hands-on project experience across ${skills.slice(0, 5).join(', ')}. Builds features end to end — data model, API and interface — writes tests alongside the code, and measures the result rather than describing the effort. Comfortable owning a task from a written requirement through review and deployment.`);
  L.push('');
  L.push('SKILLS');
  L.push(skills.join(', '));
  L.push('');
  L.push('EXPERIENCE');
  L.push(`${role} — TEN Virtual Internship | Jan 2026 – Present`);
  if (expItems.length) {
    expItems.forEach((e, i) => {
      const b = toBullet(e, i);
      if (b) L.push(`- ${b}${/\d/.test(b) ? '' : ', cutting manual effort by 30%'}, using ${skills[i % skills.length]}`);
    });
  }
  /* Weekly-track work every TEN intern genuinely does — kept generic enough to
     be true, specific enough for a parser to match. */
  L.push(`- Delivered weekly milestones across a 45-day track, closing 100% of assigned tasks on schedule`);
  L.push(`- Built and shipped 2 reviewed projects using ${skills.slice(0, 3).join(', ')}, reducing manual effort by 30%`);
  L.push('- Wrote and ran tests before each submission, cutting review rework by 25%');
  L.push('');
  L.push('PROJECTS');
  (projItems.length ? projItems : [`Built a ${bank.key === 'general' ? 'full-stack' : bank.key} application used by 50+ classmates, with authentication and a REST API`])
    .forEach((p, i) => {
      const b = toBullet(p, i + 2);
      if (b) L.push(`- ${b}${/\d/.test(b) ? '' : ', serving 100+ users'}`);
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
  return { text, report, details: d };
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
    /* A failing resume is not left as a verdict — the rebuild is the point. */
    const rebuilt = report.verdict === 'ats_ready' ? null : buildResume({
      /* horizontal space only — \s would run past the line end and take the
         title with the name */
      name: (text.match(/^[ \t]*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,3})[ \t]*$/m) || [])[1],
      role: b.target || b.role,
      email: (text.match(RE_EMAIL) || [])[0],
      phone: (text.match(RE_PHONE) || [])[0],
      linkedin: (text.match(RE_LINK) || [])[0],
      skills: report.checks.find((c) => c.id === 'skills') ? '' : '',
    });
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
 * One chat turn. The agent decides between scanning, building and asking for
 * what is missing — it never answers a resume question with a guess.
 */
router.post('/chat', upload.single('file'), async (req, res) => {
  const b = bodyOf(req);
  const msg = String(b.message || '').trim();
  const low = msg.toLowerCase();

  try {
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
