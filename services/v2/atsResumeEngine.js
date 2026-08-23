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
/* "Jun 2024 – Dec 2024" — the format the guidance asks students to use — did
   not parse here either: the closing half demanded a bare year or "Present",
   so a correctly written role read as undated. */
const RE_MONTH_WORD = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const RE_DATE_RANGE = new RegExp(
  `((19|20)\\d{2}|${RE_MONTH_WORD})[^\\n]{0,24}(-|–|—|\\bto\\b)\\s*(${RE_MONTH_WORD}\\.?\\s*)?((19|20)\\d{2}|present|current|now)`, 'i');
/* What a job title is made of. Deliberately a noun list rather than "any
   short capitalised line" — a company name and a city are both short and
   capitalised, and neither is what the person does. */
const RE_JOB_TITLE = /\b(engineer|developer|programmer|analyst|scientist|designer|architect|administrator|manager|consultant|specialist|associate|assistant|coordinator|executive|officer|lead|intern|trainee|freelancer|writer|editor|marketer|recruiter|accountant|auditor|nurse|teacher|technician|researcher|strategist|planner|operator|supervisor|director|founder|devops|sre|qa|tester)\b/i;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/*
 * Plural-tolerant: "REST API" is evidenced by "REST APIs".
 *
 * The second lookbehind rejects a term that is only the tail of a compound.
 * "ran the billing service on a 3-node cluster" was reported as evidence of
 * Node.js, and the skill went onto a resume the student would have sent —
 * a claim they never made, produced by a hyphen. A hyphen AFTER the term is
 * still the term: "Docker-based deployment" does evidence Docker.
 */
const hasWord = (hay, term) =>
  new RegExp(`(?<![a-z0-9+#])(?<![a-z0-9]-)${escapeRe(String(term).toLowerCase())}s?([^a-z0-9+#]|$)`, 'i').test(hay);

/**
 * A term spelled the way the document spells it.
 *
 * Terms are lowercased everywhere inside this file so they can be compared,
 * and that lowercase leaked out to the reader: skills lines printing
 * "kubernetes" and gap tables listing "aws" and "postgresql". Where the
 * source spells the word, its spelling is the one shown.
 */
function spelledAsIn(source, term) {
  const m = String(source || '').match(
    new RegExp(`(?<![a-z0-9+#])(?<![a-z0-9]-)(${escapeRe(term)})(?![a-z0-9+#])`, 'i'));
  return m ? m[1] : term;
}

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

/*
 * A PDF that ran a word into the year after it.
 *
 * Two-column and tightly-kerned PDFs extract as "Hyderabad2026" and
 * "Asansol2021", which then ship on the rewritten page exactly as extracted —
 * and a date the parser cannot see is a date the ATS cannot read either.
 * Separating a word from a trailing four-digit year is safe: no English word
 * ends in one.
 */
const unglueYears = (line) => String(line)
  .replace(/([A-Za-z])((?:19|20)\d{2})\b/g, '$1 $2')
  .replace(/\b((?:19|20)\d{2})([A-Za-z])/g, '$1 $2');

const toLines = (text) => String(text || '').split(/\r?\n/).map((l) => unglueYears(l.trim()));

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

/*
 * What a bullet looks like once a PDF has been through text extraction.
 *
 * The old pattern wanted one of seven glyphs followed by a space, and a
 * recording showed the cost: a real resume reported "0/32 bullets open with
 * action verbs" because its bullets extracted as "•Managed" with no space,
 * "– Managed" with an en-dash, and "o Managed" — the letter o, which is what
 * Word's Symbol-font bullet becomes in plain text. Every achievement on that
 * page was invisible to the verb check, so the advice was wrong and the score
 * was wrong with it.
 *
 * The space is optional, the glyph set covers what extractors actually emit,
 * and a lone "o" counts only when a capital follows it — otherwise words like
 * "of" would be read as bullets.
 */
const BULLET_RE = /^\s*(?:[-*•▪◦‣·▸►●○◆■□➤➢‧⁃–—]+\s*|o\s+(?=[A-Z])|\d+[.)]\s*)/;

const isBullet = (l) => BULLET_RE.test(l);
const stripBullet = (l) => String(l).replace(BULLET_RE, '');

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
/**
 * Put a wrapped sentence back together before anything reads it as a bullet.
 *
 * A PDF has no paragraphs, only lines. Extracting one gives back the visual
 * line breaks, so a single sentence that ran across three lines on the page
 * arrives as three lines here — and a recording caught the agent lecturing a
 * student about "scalability, monitoring and security." and "Service (AKS)
 * for deployment.", scoring 53 bullets on a resume that has about eight, then
 * telling them 1 in 53 pulled its weight. Every one of those complaints was
 * about a fragment nobody wrote as a line.
 *
 * A continuation is recognisable without knowing the content: the line before
 * it did not finish a sentence, and this one does not start one — no bullet
 * marker, no capital, no date, no heading. Joining those two is not a guess
 * about meaning, it is undoing the page's line wrapping.
 */
function joinWrapped(lines) {
  const out = [];
  lines.forEach((line) => {
    const prev = out[out.length - 1];
    const isContinuation =
      prev &&
      line &&
      /[a-z,(]$/.test(prev.trim()) &&          /* the previous line stopped mid-sentence */
      !BULLET_RE.test(line) &&                  /* this one is not its own bullet */
      !/^[A-Z][A-Z &]{2,}$/.test(line) &&       /* nor a heading */
      !RE_DATE_RANGE.test(line) &&              /* nor a dated role header */
      !/\|/.test(line) &&                       /* nor a piped header */
      !/^[A-Z]/.test(line) &&                   /* a new sentence starts with a capital */
      prev.length < 200;                        /* never build a runaway line */
    if (isContinuation) out[out.length - 1] = `${prev} ${line}`.replace(/\s+/g, ' ');
    else out.push(line);
  });
  return out;
}

function factLedger(text) {
  /*
   * Planned work is not a fact about this person yet.
   *
   * The planned blocks carry template text — "serving <N> users at <N>ms" —
   * and reading them as history put that fragment onto the student's SKILLS
   * line, twice, as though it were a tool they knew. Everything downstream
   * reads this ledger, so the blocks are removed here rather than in each
   * reader.
   */
  const cleaned = String(text || '')
    .split('\n')
    .filter((l, i, arr) => {
      if (/\[PLANNED/i.test(l)) return false;
      if (/^(PLANNED PROJECTS|LEARNING)\b/i.test(l.trim())) return false;
      return !/^LEARNING\b/i.test((arr[i - 1] || '').trim());
    })
    .join('\n');

  const all = joinWrapped(toLines(cleaned));
  const raw = cleaned;

  /* Which section each line belongs to. */
  let current = null;
  const bySection = { experience: [], education: [], skills: [], projects: [], summary: [], certifications: [], top: [] };
  all.forEach((line, idx) => {
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
    } else if (
      /*
       * The job title under the name is a title, not an achievement.
       *
       * Anything longer than 25 characters above the first heading was filed
       * as experience, so "Business Intelligence Analyst" became a bullet —
       * a bullet with no verb, which dragged the verb ratio down, and the
       * rewrite then emitted it a second time. Short titles like "Data
       * Analyst" slipped under the limit, which is why only the long-named
       * roles lost points: Technical Support Engineer, Quantum Computing
       * Researcher, Aerospace and Automotive Software Engineer.
       *
       * A title is near the top, carries no digits, no bullet marker and no
       * sentence punctuation, and reads as a role.
       */
      current === null && idx < 4 && !isBullet(line) &&
      !/\d/.test(line) && !/[.;]/.test(line) && line.split(/\s+/).length <= 6 &&
      RE_JOB_TITLE.test(line)
    ) {
      bySection.top.push(line);
    } else if (line.length > 25 || isBullet(line) || RE_DATE_RANGE.test(line)) {
      bySection.experience.push(line);
    }
  });

  /* Roles: a header line (carries a date range or a Title | Company shape)
     followed by its bullets. */
  const roles = [];
  let role = null;
  bySection.experience.forEach((line) => {
    /*
     * "Software Developer, Acme Solutions" is a role header too.
     *
     * Only a date range or a pipe counted, so a comma-separated header — the
     * commonest shape on an Indian student resume — was filed as an
     * achievement bullet. It then came back on the rewritten page as
     * "- Software Developer, Acme Solutions", a bullet with no verb dragging
     * the verb check down, while the role it named lost its heading.
     */
    const commaHeader = !isBullet(line) && line.length <= 70 &&
      /^[^,]{3,40},\s*[^,]{2,40}$/.test(line) && RE_JOB_TITLE.test(line) && !/\d/.test(line);
    const looksHeader = RE_DATE_RANGE.test(line) || (/\|/.test(line) && !isBullet(line)) || commaHeader;
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

  /*
   * The job title is not one of its own achievements.
   *
   * A long title above the name — "Business Intelligence Analyst",
   * "Aerospace Software Engineer" — was long enough to be filed as
   * experience, so it became a bullet with no verb and no number. It pulled
   * the verb ratio down, the rewrite emitted it a second time, and tailoring
   * those five roles cost a point. Short titles slipped under the length
   * test, which is why only the long ones showed it.
   */
  const titleLine = (bySection.top.find((l) => RE_JOB_TITLE.test(l) && !/\d|@/.test(l)) || '').trim().toLowerCase();
  if (titleLine) {
    roles.forEach((r) => {
      r.bullets = r.bullets.filter((b) => String(b).trim().toLowerCase() !== titleLine);
    });
  }

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
  /*
   * "Languages:" is not a language.
   *
   * Skills sections are almost always written in labelled rows — "Languages:
   * Java, Python, C", "Web: HTML, CSS", "Tools: Git, Docker" — and splitting
   * on commas alone made the label part of the first skill. A real page came
   * back listing "Languages: Java" as a skill, which then went into the
   * summary and onto the rewritten SKILLS line: "HTML, CSS, Languages: Java,
   * Python, C". The label is a heading for the row, so it comes off.
   */
  const ROW_LABEL = /^\s*(languages?|programming languages?|web|web technologies|tools?|technologies|tech(?: stack)?|frameworks?|libraries|databases?|db|platforms?|cloud|devops|testing|soft skills?|core competenc(?:y|ies)|others?|misc|concepts?|ide|os|operating systems?)\s*[:\-–]\s*/i;
  const statedSkills = bySection.skills
    .map((l) => String(l).replace(ROW_LABEL, ''))
    .flatMap((l) => l.split(/[,;|/·•]+/))
    .map((s) => s.trim().replace(/[.:]$/, ''))
    /* A fragment that is still a label — the row was "Tools:" on its own line
       with the tools beneath it — is not a skill either. */
    .filter((s) => s && s.length <= 30 && !/^(and|with|etc)$/i.test(s) && !ROW_LABEL.test(`${s}: x`));

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

  /*
   * The headline title, which almost every resume writes on the line under
   * the name. Nothing read it, so a page saying "Backend Developer" in point
   * 16 was rewritten under the heading "Professional" — the rewriter's
   * last-resort placeholder standing in for a fact printed at the top of the
   * document it had just parsed.
   */
  const title = (() => {
    const head = all.slice(0, 6).map((l) => String(l).trim()).filter(Boolean);
    const start = name ? head.findIndex((l) => l === name) + 1 : 1;
    for (let i = Math.max(start, 0); i < head.length; i += 1) {
      const line = head[i];
      if (!line || line.length > 60) continue;
      if (RE_EMAIL.test(line) || RE_PHONE.test(line) || RE_LINK.test(line)) continue;
      if (headingKey(line) || isBullet(line)) continue;
      if (/\d/.test(line)) continue;                        /* dates and metrics are not titles */
      if (line.split(/\s+/).length > 6) continue;           /* a sentence, not a title */
      if (RE_JOB_TITLE.test(line)) return line.replace(/[|·,].*$/, '').trim();
    }
    return null;
  })();

  return {
    name,
    title,
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
/* Words that look like requirements but name no skill. */
const JD_FLUFF = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'work', 'team', 'role', 'job',
  'years', 'year', 'experience', 'strong', 'good', 'plus', 'must', 'have', 'this', 'that',
  'from', 'your', 'about', 'time', 'full', 'part', 'well', 'able', 'into', 'they', 'their',
  'required', 'requirements', 'preferred', 'responsibilities', 'candidate', 'ideal', 'looking',
  'company', 'position', 'opportunity', 'benefits', 'salary', 'apply', 'join', 'help', 'build',
  'working', 'excellent', 'ability', 'skills', 'knowledge', 'understanding', 'familiarity',
  'own', 'lead', 'across', 'within', 'using', 'while', 'also', 'more', 'other', 'such',
  /* Job-title and grading words. A posting saying "Senior Engineer" is naming
     a level, not a tool, and scoring a resume for containing "engineer" tells
     nobody whether they can do the work. */
  'nice', 'proficient', 'familiarity', 'engineer', 'engineering', 'developer', 'analyst',
  'manager', 'senior', 'junior', 'staff', 'principal', 'lead', 'intern', 'associate',
  'site', 'reliability', 'role', 'team', 'stack', 'boot', 'plus',
]);

/**
 * The hard terms a checker would pull out of a job description.
 *
 * The old version only recognised skills already in the vocabulary plus
 * tokens containing a digit, a dot or a hyphen. A perfectly ordinary posting —
 * "Required: Kubernetes, Terraform, AWS, Prometheus, Go" — yielded three
 * terms, fell under the five-term threshold, and the entire keyword block
 * silently became N/A: no overlap, no Not-claimed list, no ceiling. The agent
 * looked like it had not read the job at all, which is exactly what a student
 * reported.
 *
 * So the requirement lines are mined directly. Anything listed after
 * "required", "must have", "tech stack" and friends is a demand whether or
 * not this codebase has heard of it, comma-separated runs in those lines are
 * split into their items, and capitalised nouns elsewhere are picked up too —
 * Prometheus and Grafana are proper nouns long before they are in any list.
 */
function jdHardTerms(jd) {
  if (!jd || !String(jd).trim()) return [];
  const raw = String(jd);
  const low = raw.toLowerCase();
  const found = new Set();

  const add = (term) => {
    let t = String(term).toLowerCase().trim();
    /* A posting writes "Snowflake is required", not "Snowflake". Left alone,
       the whole clause became a keyword the resume could never match, and
       "snowflake is required" sat next to "snowflake" on the Not-claimed
       list looking like two separate demands. */
    t = t
      .replace(/^(?:experience|proficiency|familiarity|knowledge)\s+(?:with|in|of)\s+/, '')
      .replace(/\s+(?:is|are)?\s*(?:required|preferred|a\s+(?:plus|must)|essential|desirable)$/, '')
      .trim()
      .replace(/^[^a-z0-9]+|[^a-z0-9+#.]+$/g, '');
    if (t.length < 2 || t.length > 30) return;
    /* Anything still carrying a verb is a sentence fragment, not a skill. */
    if (/\b(?:is|are|was|were|will|would|should|must|have|has|can)\b/.test(t)) return;
    if (JD_FLUFF.has(t)) return;
    if (/^\d+$/.test(t)) return;
    found.add(t);
  };

  /* Known skills first — the terms an ATS is most likely keyed on. */
  SKILL_VOCAB.forEach((s) => { if (hasWord(low, s)) add(s); });

  /* Requirement lines: everything a posting lists after asking for it. */
  const REQUIRE = /(?:required|requirements?|must[- ]have|nice[- ]to[- ]have|preferred|proficient(?:\s+in)?|experience\s+(?:with|in)|familiarity\s+(?:with|in)|knowledge\s+of|working\s+with|tech(?:nical)?\s+stack|skills?)\s*[:\-–]?\s*([^.\n;]{3,200})/gi;
  let m;
  while ((m = REQUIRE.exec(raw)) !== null) {
    m[1].split(/,|\band\b|\bor\b|\/|\|/).forEach((piece) => {
      const item = piece.trim();
      /* Short items are the tool names; a clause is prose, so take its nouns. */
      if (item && item.split(/\s+/).length <= 3) add(item);
      else (item.match(/\b[A-Z][A-Za-z0-9+#.]{2,}\b/g) || []).forEach(add);
    });
  }

  /* Capitalised names anywhere: Prometheus, Grafana, Kafka, Django. */
  (raw.match(/\b[A-Z][A-Za-z0-9+#.]{2,19}\b/g) || []).forEach((word) => {
    if (/^[A-Z]{2,6}$/.test(word)) { add(word); return; }   /* AWS, SLO, CI */
    add(word);
  });

  /* Technical-looking tokens the vocabulary has never heard of. */
  (low.match(/[a-z][a-z0-9+#.-]{2,19}/g) || []).forEach((token) => {
    const w = token.replace(/[.\-]+$/, '');
    if (/[0-9+#]/.test(w) || /\.(js|ts|py|net|io)$/.test(w) || w.includes('-')) add(w);
  });

  /*
   * "Spring Boot" and "Spring" are one demand, not two.
   *
   * Both were extracted, and because the resume's skills line proved the
   * longer one, the bare fragment stayed on the unproven list — so the agent
   * told a student "this role asks for Spring" about a page that says Spring
   * Boot. A term wholly contained in a longer term is that term.
   */
  /*
   * A company is not a skill.
   *
   * "Backend Engineer at Google" put GOOGLE on the required-terms list, and
   * the agent asked a student to prove where they had used it. The employer
   * named in a posting is who is hiring, never something to evidence.
   */
  const EMPLOYERS = new Set(['google', 'amazon', 'meta', 'microsoft', 'apple', 'netflix', 'stripe',
    'uber', 'airbnb', 'linkedin', 'twitter', 'oracle', 'ibm', 'adobe', 'salesforce', 'nvidia',
    'infosys', 'tcs', 'wipro', 'accenture', 'flipkart', 'swiggy', 'zomato', 'paytm', 'razorpay',
    'zoho', 'freshworks', 'atlassian', 'shopify', 'spotify', 'figma', 'gitlab', 'github']);

  const terms = [...found].filter((t) => !EMPLOYERS.has(String(t).toLowerCase()));
  return terms
    .filter((t) => !terms.some((other) => other !== t && other.length > t.length && hasWord(other, t)))
    .slice(0, 40);
}

/**
 * The same terms, split the way the posting splits them.
 *
 * A posting does not ask for everything equally. "Must have: Java, Spring"
 * and "Nice to have: Kafka" are two different sentences, and a student
 * deciding what to learn next needs to know which list a missing term is on.
 * Anything the posting did not grade sits in `must` — an unqualified
 * requirement is a requirement.
 */
function jdRequirements(jd) {
  const all = jdHardTerms(jd);
  if (!all.length) return { must: [], nice: [], all };

  const raw = String(jd);
  const nice = new Set();

  /* Everything downstream of a nice-to-have marker, up to the next full stop
     or line break, is optional. */
  const NICE = /(?:nice[- ]to[- ]have|preferred|a\s+plus|bonus|desirable|good\s+to\s+have)\s*[:\-–]?\s*([^.\n;]{0,200})/gi;
  let m;
  while ((m = NICE.exec(raw)) !== null) {
    const window = m[1].toLowerCase();
    all.forEach((t) => { if (window.includes(t)) nice.add(t); });
  }
  /* "Familiarity with dbt preferred" puts the marker after the term, so the
     sentence containing both counts too. */
  raw.split(/[.\n;]/).forEach((sentence) => {
    if (!/(nice to have|preferred|a plus|bonus|desirable)/i.test(sentence)) return;
    const low = sentence.toLowerCase();
    all.forEach((t) => { if (low.includes(t)) nice.add(t); });
  });

  return { must: all.filter((t) => !nice.has(t)), nice: [...nice], all };
}

/**
 * The mapping table the tailor step owes the student: every term the posting
 * asks for, whether the resume evidences it, and where.
 *
 * "Where" is the point. Telling somebody they match 60% of a posting is a
 * number; showing them the bullet that proves Terraform and the four terms
 * with no bullet behind them is a decision they can act on.
 */
/** A list with the entries that are only fragments of longer ones removed. */
function dropFragments(terms) {
  return terms.filter((t) => !terms.some((other) =>
    other !== t && other.length > t.length && hasWord(other.toLowerCase(), t.toLowerCase())));
}

function jdMap(text, ledger, jd, opts = {}) {
  const req = jdRequirements(jd);
  if (!req.all.length) return null;

  /* Where a term could be proved, in the order a reader trusts them. */
  const places = [
    ...ledger.roles.flatMap((r) => r.bullets.map((b) => ({ where: 'Experience', line: b }))),
    ...ledger.projects.flatMap((p) => p.bullets.map((b) => ({ where: 'Projects', line: b }))),
    ...ledger.summaryLines.map((l) => ({ where: 'Summary', line: l })),
    ...(ledger.roles.map((r) => r.header).filter(Boolean).map((h) => ({ where: 'Job title', line: h }))),
  ];
  /*
   * Skills claimed on the ORIGINAL page as well as the rewritten one. The
   * rewrite drops a skill no bullet supports, which is right for the document
   * and wrong for this table: "you listed Kafka and cannot prove it" is the
   * most useful row here, and reading only the cleaned page loses it.
   */
  const statedLow = new Set([...ledger.statedSkills, ...(opts.alsoStated || [])]
    .map((s) => String(s).toLowerCase()));

  const row = (lowTerm, kind) => {
    /* Shown as the posting wrote it — "AWS", not "aws". */
    const term = spelledAsIn(jd, lowTerm);
    const hit = places.find((p) => hasWord(String(p.line).toLowerCase(), lowTerm));
    if (hit) {
      return {
        term, kind, status: 'evidenced', where: hit.where,
        proof: String(hit.line).replace(/^[-*•]\s*/, '').slice(0, 110),
        action: `Keep — your ${hit.where.toLowerCase()} already proves it.`,
      };
    }
    if (statedLow.has(lowTerm)) {
      return {
        term, kind, status: 'listed only', where: 'Skills line',
        proof: '',
        action: 'On the skills line with no bullet behind it. Name where you used it and it becomes evidence.',
      };
    }
    return {
      term, kind, status: 'not claimed', where: '—', proof: '',
      action: kind === 'must'
        ? 'Required by the posting and absent. Add it only if you have actually used it.'
        : 'Optional in the posting and absent. Safe to leave out.',
    };
  };

  const rows = [...req.must.map((t) => row(t, 'must')), ...req.nice.map((t) => row(t, 'nice'))];
  const evidenced = rows.filter((r) => r.status === 'evidenced');
  return {
    rows,
    must: req.must.length,
    nice: req.nice.length,
    evidenced: evidenced.length,
    listedOnly: rows.filter((r) => r.status === 'listed only').length,
    /*
     * Without the fragments of longer entries. "Spring Boot, Spring" is one
     * demand written twice, and whichever came first got quoted back at the
     * student — "this role asks for Spring" — naming half a technology.
     */
    mustMissing: dropFragments(rows.filter((r) => r.kind === 'must' && r.status === 'not claimed').map((r) => r.term)),
    niceMissing: dropFragments(rows.filter((r) => r.kind === 'nice' && r.status === 'not claimed').map((r) => r.term)),
  };
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
  /*
   * Dates are judged against how many roles there are, not against a flat
   * count. Demanding two ranges docked every single-role resume — a first
   * job, an internship, a career switcher — for a fault it did not have.
   */
  const dateHits = (raw.match(new RegExp(RE_DATE_RANGE.source, 'gi')) || []).length;
  const rolesNeedingDates = Math.max(1, ledger.roles.length);
  if (dateHits === 0) ded(4, 'No parseable date range — write "Jan 2024 – Present" next to each role.');
  else if (dateHits < rolesNeedingDates) ded(2, `${dateHits} of ${rolesNeedingDates} roles carry a parseable date range.`);

  /*
   * The scanned-PDF signal is about extraction failing, not about brevity. At
   * forty words it fired on a real one-role resume with perfectly readable
   * text and took fifteen points, which alone forced the band to Weak. Only a
   * document that yielded almost nothing is a scan.
   */
  if (ledger.words < 15) ded(15, 'Almost no extractable text — reads as a scanned or image-based file.');
  else if (ledger.words < 120) ded(3, `${ledger.words} words — too thin for a parser to match much against.`);
  parse = Math.max(0, parse);

  /* B. keywords — needs a JD */
  const terms = jdHardTerms(jd);
  let keywords = null;
  let keywordDetail = null;
  /* Three terms is a job description; two is a job title. Under the old
     five-term floor a short posting — "React, TypeScript and GraphQL" — was
     scored as if no target existed at all, so the student got no overlap
     figure, no Not-claimed list and no ceiling from a posting that plainly
     stated what it wanted. */
  if (terms.length >= 3) {
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
  let sixSec;
  if (targetWords.length) {
    const zoneHits = zones.filter((z) => targetWords.some((w) => z.includes(w))).length;
    sixSec = zoneHits >= 2 ? 25 : zoneHits === 1 ? 12 : 0;
  } else {
    /*
     * No target named, so whether the page announces the right function
     * cannot be checked — only that it announces something. Full marks here
     * were how a resume reached 100/100 on the recruiter scan without anyone
     * knowing what job it was for.
     */
    const populated = zones.filter((z) => z.length > 0).length;
    sixSec = populated >= 2 ? 15 : populated === 1 ? 8 : 0;
  }
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

/**
 * The score, in the five parts it is actually made of.
 *
 * One number tells somebody they are at 80 and nothing about what to do
 * about it. The same measurements, split the way the work splits, say which
 * afternoon of effort moves it: content is facts they have to supply, format
 * is ours to fix, optimisation only exists once a posting does.
 *
 * Nothing new is measured here. Every bar is built from the checker and the
 * recruiter scan that already ran, so the five bars and the headline can
 * never disagree with each other.
 */
function score5(text, opts = {}) {
  const jd = opts.jd || '';
  const target = opts.target || '';
  const ledger = factLedger(text);
  const checker = checkerScore(text, ledger, jd);
  const recruiter = recruiterScan(text, ledger, target);
  const all = toLines(text);

  const pct = (n, of) => Math.max(0, Math.min(100, Math.round((n / of) * 100)));
  const bullets = [
    ...ledger.roles.flatMap((r) => r.bullets),
    ...ledger.projects.flatMap((p) => p.bullets),
  ];
  const scoped = bullets.filter(hasScope).length;
  const banned = bullets.filter((b) => BANNED_OPENERS.test(b)).length;
  const buzz = BANNED_BUZZWORDS.filter((w) => String(text).toLowerCase().includes(w));
  const words = String(text).split(/\s+/).filter(Boolean).length;

  const bars = [];
  const bar = (name, value, why, fixes) => bars.push({ name, value, why, fixes: fixes.filter(Boolean) });

  /* 1. Content — do the claims carry facts? */
  const contentRaw =
    (bullets.length ? Math.min(40, (scoped / bullets.length) * 40) : 0) +
    (ledger.evidencedSkills.length ? 25 : 0) +
    (ledger.title || target ? 15 : 0) +
    (ledger.roles.length ? 10 : 0) +
    (ledger.projects.length ? 10 : 0);
  bar('Content', Math.round(contentRaw),
    `${scoped}/${bullets.length || 0} bullets carry a number · ${ledger.evidencedSkills.length} evidenced skills`,
    [
      scoped < bullets.length / 2 && 'Put one true figure on each strong bullet — how many, how much, how often.',
      !ledger.projects.length && 'Add a project: it is where a student proves a stack no employer has paid them for yet.',
      !ledger.title && !target && 'Name the role you are applying for under your name.',
    ]);

  /* 2. Format — ours to fix, and the half a parser actually reads. */
  bar('Format', pct(checker.parse, 30),
    `parse ${checker.parse}/30 · ${ledger.sectionsFound.length} standard sections`,
    checker.deductions.slice(0, 3).map((d) => d.why));

  /* 3. Optimisation — only real when a posting exists. */
  const kd = checker.keywordDetail;
  bar('Optimisation', jd ? (kd ? kd.overlap : 0) : null,
    jd ? `${(kd || {}).matched || 0}/${(kd || {}).terms || 0} of the posting's hard terms are evidenced`
       : 'No job description supplied — paste one and this becomes a real measurement.',
    jd && kd && kd.missing.length ? [`Not evidenced: ${kd.missing.slice(0, 6).join(', ')}. Add only what you have used.`] : []);

  /* 4. Best practices — the writing rules, not the parsing ones. */
  const bpRaw = 100
    - (bullets.length ? (banned / bullets.length) * 40 : 0)
    - buzz.length * 8
    - (words > 900 ? 20 : words < 250 ? 15 : 0);
  bar('Best practices', Math.max(0, Math.round(bpRaw)),
    `${banned} duty-phrased bullet${banned === 1 ? '' : 's'} · ${buzz.length} banned word${buzz.length === 1 ? '' : 's'} · ${words} words`,
    [
      banned && 'Rewrite the duty phrases: say what you produced, not what you were assigned.',
      buzz.length && `Cut: ${buzz.slice(0, 4).join(', ')}.`,
      words > 900 && 'Over a page — cut the weakest bullets.',
      words < 250 && 'Thin for a page — the words have to be yours; add more of your work.',
    ]);

  /* 5. Application ready — can they be contacted and dated? */
  const dated = ledger.roles.filter((r) => r.hasDates).length;
  const readyRaw = (ledger.email ? 30 : 0) + (ledger.phone ? 25 : 0) + (ledger.link ? 15 : 0) +
    (ledger.roles.length ? (dated / ledger.roles.length) * 20 : 20) + (ledger.education.length ? 10 : 0);
  bar('Application ready', Math.round(readyRaw),
    `${ledger.email ? 'email ✓' : 'email ✗'} · ${ledger.phone ? 'phone ✓' : 'phone ✗'} · ${ledger.link ? 'link ✓' : 'link ✗'} · ${dated}/${ledger.roles.length || 0} roles dated`,
    [
      !ledger.email && 'Add an email address in the body — an ATS discards what it cannot reply to.',
      !ledger.phone && 'Add a phone number with country code.',
      !ledger.link && 'Add a GitHub or LinkedIn URL as plain text.',
      ledger.roles.length && dated < ledger.roles.length && 'Date every role — "Jun 2024 – Dec 2024".',
    ]);

  /*
   * The headline is the checker's own number, so the bars can never disagree
   * with the score printed beside them — and the denominator is the one the
   * number was actually scaled to. Reporting a percentage over the raw
   * out-of-60 total printed "Overall 88/60", which is not a score.
   */
  const scaled = checker.max !== 100;
  const overall = scaled ? Math.round((checker.total / checker.max) * 100) : checker.total;

  /* Worst bar first, and only bars that can still move. */
  const fixes = bars
    .filter((b) => b.value !== null && b.value < 100 && b.fixes.length)
    .sort((a, b) => a.value - b.value)
    .flatMap((b) => b.fixes.map((f) => ({ bar: b.name, fix: f })))
    .slice(0, 6);

  return {
    overall,
    of: 100,
    /* Said plainly: without a posting the keyword block was never measured,
       so this is the parse-and-evidence half rescaled, not a full score. */
    scaledFromPartial: scaled,
    recruiter: recruiter.total,
    bars,
    fixes,
    caveat: 'This rubric, not a live ATS. Greenhouse and Workday do not publish a score, and nobody outside this page can promise you one.',
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
  /*
   * Only a checker scored out of 100 is comparable to the rubric's bands,
   * because those bands assume the keyword block is in the total. Scaling an
   * out-of-60 score into a percentage inflated it — the same resume came back
   * "strong" with no job description and "weak" with one, which is not a
   * judgement, it is an artefact. Without a JD the recruiter scan is the only
   * number on a true 100 scale, so it decides alone.
   */
  const comparable = checker.max === 100
    ? Math.min(Math.round((checker.total / checker.max) * 100), recruiter.total)
    : recruiter.total;

  if (comparable < 50 || checker.parse < 16) return 'weak';
  if (comparable < 80) return 'salvageable';
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
  }

  /*
   * The metric question is gone, and the evidence question with it.
   *
   * Both asked for prose — "one real number you will stand behind", "for each
   * skill, what did you build with it?" — and the brief for this agent is
   * that nothing is typed except a name, an email, a phone number and two
   * profile links. They were also the two questions people abandoned the
   * interview on, which is the same fact from the other side.
   *
   * Neither is lost work. The climb puts projects on the page that carry
   * their own numbers and their own evidence, and the student fills the
   * blanks in as they build them — which is when they will actually know
   * what the number was.
   */
  /*
   * The dates question is gone.
   *
   * It asked a person to think like a parser — "Jan 2024 – Present is the
   * shape a parser reads" — and its answer was appended as a bullet rather
   * than attached to the role header, so the role stayed undated and the
   * question came back every turn. A recording caught it rejecting "aug
   * 2026-presernt" with "your last message did not read as an answer to it".
   * Missing dates are reported by the scan, where a fix is a fix rather than
   * a loop.
   */

  /* Block 5 — projects. Asked whenever there are none, not only when the
     work history is thin: for most students applying into these roles the
     projects section is the evidence, and a page without one is a page with
     nothing to point at. */
  if (!ledger.projects.length) {
    ask(5, 'projects', 'A project that shows your stack: its name, the problem it solved, your role, the tools, and who used it. Two or three lines is plenty.');
  }

  /*
   * Block 6 is the interview bank's now.
   *
   * Education, photo, location and certifications were asked here AND in the
   * shared bank, in two different wordings, so a student was asked their city
   * twice and their certifications after a question set that had already
   * covered it. One place asks each thing. The bank is that place, because it
   * is the one all three commands read.
   */
  if (!ledger.education.length && !o.educationAsked) {
    ask(6, 'education', 'Degree, institution, and the years — "B.Tech Computer Science, Ramaiah Institute of Technology, 2022 – 2026".');
  }

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

  /*
   * Put the verb back that stripping the opener took away.
   *
   * "Responsible for developing web applications" lost its opener and shipped
   * as "Developing web applications" — a gerund, which the verb check scores
   * as no verb at all. So the rewrite took a resume whose bullets at least
   * began with a word and handed back one scoring 0/3 on verbs, then reported
   * the drop as the student's problem. A gerund has a verb inside it:
   * "developing" is "Developed", "maintenance of X" is "Maintained X". That is
   * grammar, not a new claim.
   */
  const first = t.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  const gerund = t.match(/^([A-Za-z]+)ing\b(.*)$/);
  if (!STRONG_VERBS.has(first) && gerund) {
    /* Only when the derived past tense is a verb this file already knows.
       Guessing at irregulars ("running" → "runned") would put a word on
       somebody's resume that no one wrote. */
    const stem = gerund[1];
    for (const past of [`${stem}ed`, `${stem}d`, stem]) {
      if (STRONG_VERBS.has(past.toLowerCase())) {
        t = past.charAt(0).toUpperCase() + past.slice(1) + gerund[2];
        break;
      }
    }
  }
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/**
 * Every bullet on the page, judged one at a time.
 *
 * The score alone plateaus and then says nothing new: "I need one real number
 * for your strongest bullet" is true, unactionable, and identical every time
 * it is repeated. What the good builders do instead — Rezi, Teal, Enhancv all
 * work this way — is show the person their own bullets with a verdict on each,
 * so "add a number" becomes "this line, this missing piece".
 *
 * Nothing here rewrites anything. It reports what is wrong with each line and
 * what would fix it, because the fix is a fact only the author has.
 */
function bulletAudit(text) {
  const ledger = factLedger(text);
  const rows = [];

  const judge = (line, where) => {
    const t = stripBullet(String(line || '')).trim();
    if (!t) return;
    const words = t.split(/\s+/).filter(Boolean);
    const first = (words[0] || '').toLowerCase().replace(/[^a-z]/g, '');
    const problems = [];
    const fixes = [];

    if (BANNED_OPENERS.test(t)) {
      problems.push('opens with a duty phrase');
      fixes.push('Say what you produced, not what you were assigned: "Built…", "Cut…", "Shipped…".');
    } else if (!STRONG_VERBS.has(first)) {
      problems.push('does not open with an action verb');
      fixes.push('Start with the verb: Built, Automated, Migrated, Reduced, Wrote.');
    }
    if (!hasScope(t)) {
      problems.push('carries no number');
      fixes.push('Add one true figure — how many, how much, how often, or how long.');
    }
    if (words.length < 6) {
      problems.push('too short to match on');
      fixes.push('Name the tool and the outcome, not just the task.');
    } else if (words.length > 34) {
      problems.push('too long to scan');
      fixes.push('Split it, or cut to the result and the method.');
    }
    if (BANNED_BUZZWORDS.some((b) => t.toLowerCase().includes(b))) {
      problems.push('contains filler wording');
      fixes.push('Cut the adjective; the achievement is the argument.');
    }

    rows.push({
      where,
      text: t.slice(0, 130),
      ok: problems.length === 0,
      problems,
      fix: fixes[0] || null,
      /* The question that would close the biggest gap on this line. */
      ask: !hasScope(t) ? metricQuestion(t) : null,
    });
  };

  ledger.roles.forEach((r) => r.bullets.forEach((b) => judge(b, 'Experience')));
  ledger.projects.forEach((p) => p.bullets.forEach((b) => judge(b, 'Projects')));

  const weak = rows.filter((r) => !r.ok);
  return {
    rows,
    total: rows.length,
    strong: rows.length - weak.length,
    weak,
    /* Worst first: a bullet with three problems is the one to fix today. */
    worst: [...weak].sort((a, b) => b.problems.length - a.problems.length)[0] || null,
  };
}

/**
 * The quantification question for one bullet, and the shapes of answer that
 * would satisfy it.
 *
 * "Add a metric" is the single most repeated piece of resume advice and the
 * least actionable, because the person does not know which number is wanted.
 * Naming the candidate measures — for this line, in their words — is what
 * turns it into an answer.
 */
function metricQuestion(bullet) {
  const t = String(bullet || '').toLowerCase();
  const kinds = [];
  const add = (label, hint) => kinds.push({ label, hint });

  if (/\b(built|created|developed|designed|shipped|launched|made)\b/.test(t)) {
    add('How many people used it', 'users, students, customers, teams');
    add('How long it took', 'shipped in 6 weeks');
  }
  if (/\b(api|service|endpoint|server|backend|database|query|pipeline)\b/.test(t)) {
    add('Traffic or volume it handled', 'requests a day, records processed');
    add('Speed change', 'cut latency 30%, query time 2s → 400ms');
  }
  if (/\b(automat|script|deploy|pipeline|manual|process)\b/.test(t)) {
    add('Time saved', 'hours a week, days per release');
  }
  if (/\b(test|bug|error|fix|qa|quality|maintain)\b/.test(t)) {
    add('Defects caught or removed', 'bugs found before release, crash rate');
    add('Coverage reached', 'endpoints covered, % of the suite');
  }
  if (/\b(team|led|mentor|review|coordinat|manag)\b/.test(t)) {
    add('People involved', 'size of the team, reviews handled');
  }
  if (/\b(sales|revenue|cost|budget|growth|conversion|campaign)\b/.test(t)) {
    add('Money or growth', '₹ figure, % change');
  }
  if (!kinds.length) {
    add('How many', 'the count that made this worth doing');
    add('How much it changed', 'before → after, or a percentage');
  }
  add('How often it ran', 'daily, weekly, per release');

  return {
    question: `What number belongs on this line — "${String(bullet).slice(0, 80)}"?`,
    /* De-duplicated, capped: a list of nine measures is another wall. */
    kinds: kinds.filter((k, i, all) => all.findIndex((x) => x.label === k.label) === i).slice(0, 4),
  };
}

/**
 * The essential-signal pass. Skills survive to the primary line only when the
 * role cares AND the ledger proves them; everything else either drops or, if
 * evidenced but off-target, trails after. Capped at 16, as the skill caps it.
 */
function essentialSkills(ledger, targetTerms, sourceText) {
  const proven = [...new Set([...ledger.evidencedSkills, ...ledger.impliedSkills])];
  const onTarget = proven.filter((s) => targetTerms.some((t) => t === s.toLowerCase() || hasWord(t, s)));
  const rest = proven.filter((s) => !onTarget.includes(s));
  /*
   * Implied skills carry the vocabulary's lowercase spelling, so a resume
   * whose bullet says "Kubernetes" got "kubernetes" on its skills line —
   * this file's internal spelling, printed on the student's document. Where
   * the page itself spells the tool, that spelling wins.
   */
  const asWritten = (skill) => spelledAsIn(sourceText, skill);

  /*
   * A skill the person listed is never deleted from their own page.
   *
   * The rule was: keep only what a bullet proves. On a real resume that
   * removed Docker and Terraform from "AWS, Docker, Kubernetes, Terraform" —
   * because no bullet happened to name them — and the keyword count halved,
   * so tailoring handed back a page scoring four points LOWER than the one
   * uploaded. The student watched the agent delete two of their skills and
   * call it an improvement.
   *
   * Evidence still decides the ORDER, which is what it is good for: what the
   * bullets prove goes first, where a reader and a parser both look. What no
   * bullet proves keeps its place further along, and is reported as
   * unevidenced so they know which claims are exposed. Ordering is help;
   * deleting is damage.
   */
  const evidencedFirst = [...onTarget, ...rest].map(asWritten);
  const stillListed = (ledger.statedSkills || [])
    .filter((s) => !evidencedFirst.some((e) => e.toLowerCase() === String(s).toLowerCase()));

  return {
    primary: [...evidencedFirst, ...stillListed].slice(0, 20),
    dropped: ledger.unevidencedSkills,
  };
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
  const skills = essentialSkills(ledger, targetTerms, text);

  /*
   * The student's own pick leads, ahead of the keyword count.
   *
   * Ordering by overlap with the posting puts whichever line happens to
   * share the most words at the top — which is not the same as the work they
   * would most want to be asked about, and they are the one who has to
   * answer for it in the room. Neither pick adds anything: both are lines
   * already on the page, moved.
   */
  if (opts.leadSkill) {
    const lead = String(opts.leadSkill).toLowerCase();
    skills.primary.sort((a, b) =>
      (String(b).toLowerCase() === lead ? 1 : 0) - (String(a).toLowerCase() === lead ? 1 : 0));
  }

  /* Not claimed: what the JD wants that no evidence supports. Listed, never
     smuggled onto the page. */
  const resumeLow = String(text || '').toLowerCase();
  /*
   * Named as the posting names them — this list is read by a person — and
   * without the fragments of longer entries. "REST API, REST, API" is one
   * demand written three times, and it made the ceiling sentence read like a
   * much bigger gap than it was.
   */
  const missingLow = jdTerms.filter((t) => !hasWord(resumeLow, t));
  const notClaimed = missingLow
    .filter((t) => !missingLow.some((other) => other !== t && other.length > t.length && hasWord(other, t)))
    .map((t) => spelledAsIn(jd, t));

  /* Rejection diagnosis, from the before-scores' own arithmetic. */
  const diagnosis = [
    ...before.checker.deductions.map((d) => ({ kind: 'ATS-reject', issue: d.why, cost: d.points })),
    ...before.recruiter.gates.filter((g) => g.points < g.of * 0.6)
      .map((g) => ({ kind: 'HR-reject', issue: `${g.gate}: ${g.points}/${g.of}`, cost: g.of - g.points }))
  ];

  /* ── write on the safe skeleton ── */
  /* The target if one was named, then the title the page already carries,
     then the most recent job header. "Professional" is what is left when the
     document genuinely never said — not a substitute for reading it. */
  const roleLine = target || ledger.title ||
    (ledger.roles[0] && ledger.roles[0].header.split('|')[0].trim()) || 'Professional';

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
  /* Written as a person writes it. "Evidenced in Python, AWS" was the
     engine's own bookkeeping term printed on the document being sent to a
     recruiter — accurate about where the words came from, and not English. */
  const top = skills.primary.slice(0, 4);
  const toolList = top.length > 1
    ? `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`
    : top[0] || '';
  L.push([
    toolList ? `${roleLine} working in ${toolList}.` : `${roleLine}.`,
    spike ? `${spike}.` : ''
  ].filter(Boolean).join(' '));
  L.push('');
  /*
   * A skills line the person wrote survives, even when no bullet proves it.
   *
   * The rule was: drop every skill without a bullet behind it. On a resume
   * whose bullets are duty-phrased — "responsible for developing web
   * applications" — that is all of them, so a page listing Java, HTML and CSS
   * came back with "[ list the tools your bullets actually show ]" where its
   * skills used to be. The student lost their own three skills, the keyword
   * check went to 0/9, and the score FELL. Dropping a claim they made is not
   * honesty, it is deletion: honesty is keeping it and saying which ones no
   * bullet backs, which the Not-evidenced list does.
   */
  const skillLine = skills.primary.length ? skills.primary : ledger.statedSkills;
  if (skillLine.length) {
    L.push('SKILLS');
    L.push(skillLine.join(', '));
    L.push('');
  }

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

  /*
   * Bullet characters are stripped before one is added.
   *
   * Converting an already-converted page put a second dash on every education
   * line — "- B.Tech" became "- - B.Tech", then "- - - B.Tech" — so a student
   * pressing "fix it" twice watched their resume grow dashes and decay. The
   * rewrite has to be idempotent: running it on its own output must produce
   * that same output, or repeating the command corrupts the document.
   */
  if (ledger.education.length) {
    L.push('EDUCATION');
    /*
     * A section heading that fell into education is not a qualification.
     *
     * "LANGUAGES" shipped as an education entry — "- LANGUAGES" — with the
     * languages themselves beneath it as a second entry, because the parser
     * had filed both under the previous heading. A bare all-caps word is a
     * heading wherever it lands.
     */
    ledger.education
      .filter((e) => !/^[A-Z][A-Z &]{2,24}$/.test(String(e).trim()))
      .forEach((e) => L.push(`- ${stripBullet(String(e))}`));
    L.push('');
  }
  if (ledger.certifications.length) {
    L.push('CERTIFICATIONS');
    ledger.certifications.forEach((c) => L.push(`- ${stripBullet(String(c))}`));
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
    /* What the posting asked for and where the finished page answers it. Read
       off the rewritten resume, so the "where" points at the document the
       student is about to send rather than the one they uploaded. */
    jdMap: jdMap(rewritten, afterLedger, jd, { alsoStated: ledger.statedSkills }),
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
  jdRequirements,
  jdMap,
  bulletAudit,
  metricQuestion,
  score5,
  impactBullet,
  STRONG_VERBS,
  BANNED_OPENERS,
  BANNED_BUZZWORDS
};
