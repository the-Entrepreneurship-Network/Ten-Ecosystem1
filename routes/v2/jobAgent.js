/*
 * The Job Portal agent — reads a resume, then goes and finds the work.
 *
 * What it actually does, stated plainly, because the difference matters:
 *
 *   LIVE   Real openings are fetched from job boards that publish a public
 *          API — Remotive, RemoteOK, Arbeitnow and Hacker News "Who is
 *          hiring". No key, no login, no scraping: these endpoints exist to
 *          be read. Results are ranked against the resume.
 *
 *   AIMED  LinkedIn, Upwork, Fiverr, Naukri, Indeed, Wellfound and
 *          Internshala have no public job API, and scraping them behind a
 *          login breaks their terms and gets an IP banned. So the agent does
 *          the next best thing and does it well: it composes the exact search
 *          each platform understands — the boolean string, the filters, the
 *          Google x-ray query — from the resume it just read, as one-click
 *          links. The student lands on real results rather than an empty box.
 *
 * Nothing is invented. Every listing shown is one a board published, and
 * every link is a query the platform runs itself.
 */

const express = require('express');
const { httpFetch } = require('../../services/v2/httpFetch');
const router = express.Router();
const multer = require('multer');

const { fitness, atsMatch, requiredYears } = require('../../services/v2/jobFitness');
const { tailorResume, coverLetter, coldEmail, hrEmail } = require('../../services/v2/jobMaterials');
const directLink = require('../../services/v2/jobDirectLink');
const jobCache = require('../../services/v2/jobCache');
const atsBoards = require('../../services/v2/atsBoards');
const recruiterContacts = require('../../services/v2/recruiterContacts');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
router.use(express.urlencoded({ extended: true, limit: '2mb' }));

const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

/* ── reading the resume into a search profile ───────────────────────────── */

/* One vocabulary, shared with the scorer. Kept in jobFitness so the resume
   reader and the fitness scorer cannot disagree about what a skill is. */
const { SKILL_VOCAB } = require('../../services/v2/jobFitness');

const TITLE_HINTS = [
  ['full stack developer', ['full stack','fullstack','mern','mean stack']],
  ['frontend developer', ['frontend','front-end','react developer','ui developer']],
  ['backend developer', ['backend','back-end','node developer','api developer']],
  ['python developer', ['python developer','django','flask']],
  ['java developer', ['java developer','spring boot']],
  ['mobile developer', ['flutter','android developer','ios developer','react native']],
  ['data scientist', ['data scientist','machine learning','ml engineer','data science']],
  ['data analyst', ['data analyst','business intelligence','power bi','tableau']],
  ['devops engineer', ['devops','sre','cloud engineer','platform engineer']],
  ['security analyst', ['cyber security','security analyst','penetration tester','soc analyst']],
  ['software engineer', ['software engineer','sde','software developer']],
  ['business analyst', ['business analyst','product analyst']],
  ['ui ux designer', ['ux designer','ui designer','product designer']],
  ['hr executive', ['human resource','hr executive','recruiter','talent acquisition','recruitment','onboarding','payroll','hris','people operations','campus hiring']],
  ['marketing executive', ['marketing','seo','social media','content writing','campaign']],
  ['finance analyst', ['financial modelling','valuation','accounts','audit','bookkeeping']],
];

/*
 * Which role bank a resume's skills point at, used when no title phrase
 * appeared. Defaulting to "software engineer" mislabelled an HR resume — it
 * listed recruitment, onboarding, HRIS and payroll — and then handed that
 * person a maintenance job, because every later filter trusted the wrong
 * target. Counting evidence beats assuming a default.
 */
const ROLE_SKILL_BANK = {
  'full stack developer': ['react', 'node', 'express', 'mongodb', 'typescript', 'redux', 'next.js'],
  'frontend developer': ['react', 'html', 'css', 'tailwind', 'javascript', 'accessibility'],
  'backend developer': ['node', 'express', 'sql', 'postgresql', 'rest api', 'microservices'],
  'python developer': ['python', 'django', 'flask', 'fastapi'],
  'java developer': ['java', 'spring', 'spring boot', 'hibernate'],
  'mobile developer': ['flutter', 'dart', 'android', 'ios', 'kotlin', 'swift'],
  'data scientist': ['machine learning', 'deep learning', 'tensorflow', 'pytorch', 'scikit-learn', 'nlp'],
  'data analyst': ['sql', 'excel', 'power bi', 'tableau', 'pandas', 'data analysis', 'data visualization'],
  'devops engineer': ['docker', 'kubernetes', 'terraform', 'jenkins', 'aws', 'ci/cd', 'linux', 'azure', 'gcp'],
  'security analyst': ['cyber security', 'penetration testing', 'owasp', 'siem', 'soc', 'cryptography'],
  'hr executive': ['recruitment', 'onboarding', 'payroll', 'hris'],
  'marketing executive': ['seo', 'social media', 'content writing', 'market research'],
  'finance analyst': ['financial modelling', 'valuation', 'excel'],
};

function roleFromSkills(skills) {
  let best = '';
  let bestHits = 0;
  for (const [role, words] of Object.entries(ROLE_SKILL_BANK)) {
    const hits = words.filter((w) => skills.includes(w)).length;
    if (hits > bestHits) { bestHits = hits; best = role; }
  }
  /* Two overlapping skills is thin evidence but still evidence; one is noise. */
  return bestHits >= 2 ? best : '';
}

const SENIORITY = [
  ['intern', ['intern','internship','trainee']],
  ['entry', ['fresher','graduate','entry level','junior','jr.']],
  ['mid', ['3+ years','4 years','mid-level','associate']],
  ['senior', ['senior','sr.','lead','principal','architect','manager']],
];

const INDIAN_CITIES = ['bengaluru','bangalore','hyderabad','pune','mumbai','delhi','noida','gurgaon','gurugram','chennai','kolkata','ahmedabad','jaipur','indore','bhubaneswar','remote'];

/*
 * Roles that hire from the same pool.
 *
 * A full-stack developer is a serious candidate for a backend or a frontend
 * post, and a recruiter advertising "Software Engineer" would happily read
 * their CV. Matching only the exact title handed one contact to a strong
 * profile and hid four others that were the same job under a different name,
 * so a role brings its neighbours with it. Each list is deliberately
 * conservative: a neighbour is a role the person could defend in an
 * interview, not merely one in the same industry.
 */
const ADJACENT_ROLES = {
  'full stack developer': ['full stack', 'fullstack', 'backend', 'back end', 'frontend', 'front end', 'software engineer', 'web developer', 'mern'],
  'frontend developer': ['frontend', 'front end', 'ui developer', 'react developer', 'web developer', 'full stack', 'software engineer'],
  'backend developer': ['backend', 'back end', 'api developer', 'full stack', 'software engineer', 'platform engineer'],
  'software engineer': ['software engineer', 'software developer', 'backend', 'frontend', 'full stack', 'sde', 'application engineer'],
  'python developer': ['python', 'backend', 'django', 'flask', 'software engineer', 'data engineer'],
  'java developer': ['java', 'backend', 'spring', 'software engineer'],
  'mobile developer': ['mobile', 'android', 'ios', 'flutter', 'react native'],
  'data scientist': ['data scientist', 'machine learning', 'ml engineer', 'data analyst', 'ai engineer', 'research engineer'],
  'data analyst': ['data analyst', 'analytics', 'business intelligence', 'data engineer', 'reporting analyst', 'data scientist'],
  'devops engineer': ['devops', 'sre', 'site reliability', 'platform engineer', 'cloud engineer', 'infrastructure'],
  'security analyst': ['security', 'soc analyst', 'infosec', 'penetration tester', 'application security'],
  'business analyst': ['business analyst', 'product analyst', 'operations analyst', 'data analyst'],
  'ui ux designer': ['ux designer', 'ui designer', 'product designer', 'interaction designer'],
  'hr executive': ['hr', 'human resource', 'recruiter', 'talent acquisition', 'people operations'],
};

/** The role plus the roles a recruiter would consider equivalent to it. */
function roleFamily(role) {
  const key = String(role || '').toLowerCase().trim();
  const listed = ADJACENT_ROLES[key];
  if (listed) return [key, ...listed];
  /* Unknown role: its own distinctive words still stand in for the family. */
  return [key, ...key.split(/\s+/).filter((w) => w.length > 3 && !ROLE_STOP.has(w))];
}

function profileFromResume(text) {
  const raw = String(text || '');
  const low = raw.toLowerCase();

  const skills = SKILL_VOCAB.filter((s) => low.includes(s));

  let role = '';
  let best = 0;
  for (const [title, hints] of TITLE_HINTS) {
    const hits = hints.filter((h) => low.includes(h)).length;
    if (hits > best) { best = hits; role = title; }
  }
  if (!role) {
    /* fall back to a title line near the top — most resumes put it under the name */
    const head = raw.split(/\r?\n/).slice(0, 6).join(' ').toLowerCase();
    const guess = TITLE_HINTS.find(([, hints]) => hints.some((h) => head.includes(h)));
    /* Then what the skills themselves say, and only then a default — an
       unrecognised resume is not automatically a software engineer. */
    role = guess ? guess[0]
      : roleFromSkills(skills)
      || (skills.includes('react') || skills.includes('node') ? 'full stack developer' : 'software engineer');
  }

  let seniority = 'entry';
  for (const [level, hints] of SENIORITY) if (hints.some((h) => low.includes(h))) seniority = level;

  const location = INDIAN_CITIES.find((c) => low.includes(c)) || 'remote';
  /* \s matches newlines, so the original anchor ran past the end of the line
     and captured the job title with the name. Horizontal space only. */
  const name = (raw.match(/^[ \t]*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,3})[ \t]*$/m) || [])[1] || null;

  /* Fitness scoring needs more than skills: years, what was built, and
     whether there is a degree. All read from the same text, all optional —
     a resume that omits them simply scores on the dimensions it does show. */
  const years = yearsOfExperience(raw);
  const projects = projectLines(raw);
  const education = /\b(b\.?tech|b\.?e\.?|bachelor|master|m\.?tech|mba|b\.?sc|m\.?sc|diploma)\b/i.test(low)
    ? (raw.match(/^.*\b(?:b\.?tech|b\.?e\.?|bachelor|master|m\.?tech|mba|b\.?sc|m\.?sc)\b.*$/im) || [])[0] || true
    : null;

  return {
    name, role, seniority, location,
    skills: skills.slice(0, 18),
    keywordCount: skills.length,
    years, projects, education,
    domains: [],
    summary: raw.slice(0, 400)
  };
}

/**
 * Years of experience the resume claims. Prefers an explicit statement, and
 * otherwise infers from the earliest work year mentioned — a resume listing
 * 2021–present is making a claim even without writing the number.
 */
function yearsOfExperience(text) {
  const low = String(text || '').toLowerCase();

  const stated = low.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)\s*(?:of\s*)?(?:experience|exp)/);
  if (stated) return Math.round(parseFloat(stated[1]));

  const years = (low.match(/\b(19[89]\d|20[0-4]\d)\b/g) || []).map(Number)
    .filter((y) => y >= 1990 && y <= new Date().getFullYear());
  if (years.length) {
    const span = new Date().getFullYear() - Math.min(...years);
    /* Graduation years would otherwise read as decades of work. */
    return span > 0 && span < 40 ? span : null;
  }
  return null;
}

/** Lines that describe something built, used to judge project relevance. */
function projectLines(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^projects?\b/i.test(l));
  const picked = start >= 0 ? lines.slice(start + 1, start + 12) : [];
  const built = lines.filter((l) => /\b(built|created|developed|designed|implemented|shipped)\b/i.test(l));
  return [...new Set([...picked, ...built])].filter((l) => l.length > 20).slice(0, 12);
}

/* ── matching ──────────────────────────────────────────────────────────── */

/*
 * Substring matching on the first word of a role was quietly poisoning the
 * results: "full stack developer" starts with "full", which appears in
 * "full-time", so every full-time warehouse job matched. Terms are matched on
 * word boundaries, generic words are dropped, and the role is also tried as a
 * whole phrase.
 */
const ROLE_STOP = new Set(['full', 'part', 'time', 'stack', 'level', 'entry', 'mid', 'senior', 'junior', 'the', 'and', 'for', 'with', 'job', 'jobs', 'work']);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasWord(hay, term) {
  if (!term) return false;
  return new RegExp(`(^|[^a-z0-9+#])${escapeRe(term.toLowerCase())}([^a-z0-9+#]|$)`, 'i').test(hay);
}

function matchTerms(profile) {
  const role = String(profile.role || '').toLowerCase();
  return {
    phrases: [role, role.replace(/\s+/g, '')].filter((p) => p.length > 4),
    roleWords: role.split(/\s+/).filter((w) => w.length > 3 && !ROLE_STOP.has(w)),
    skills: (profile.skills || []).map((s) => s.toLowerCase()),
  };
}

/* Score and, crucially, decide whether a listing is relevant at all. A job
   that matches nothing but "posted recently and is remote" is noise. */
function relevance(hay, terms) {
  const phraseHit = terms.phrases.some((p) => hay.includes(p));
  const roleHits = terms.roleWords.filter((w) => hasWord(hay, w)).length;
  const skillHits = terms.skills.filter((s) => hasWord(hay, s));
  return {
    relevant: phraseHit || roleHits > 0 || skillHits.length > 0,
    points: (phraseHit ? 5 : 0) + roleHits * 3 + skillHits.length * 2,
    skillHits,
  };
}

/* ── the live sources ──────────────────────────────────────────────────── */

const UA = { 'User-Agent': 'TEN-JobAgent/1.0 (+https://entrepreneurshipnetwork.net)' };

/* Used to sort hiring posts that publish an address to the front. */
const RE_CONTACT_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;

async function getJSON(url, ms = 7000) {
  const res = await httpFetch(url, { headers: UA, timeoutMs: ms });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/* Board payloads carry HTML: tags to strip and entities to decode, or titles
   arrive reading "Software Engineer &#x2F; Data Scientist". */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#x27': "'", '#x2F': '/', '#39': "'", '#47': '/' };
const clean = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m, code) => {
      const key = code.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      if (key.startsWith('#x')) return String.fromCharCode(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCharCode(parseInt(key.slice(1), 10));
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();

async function fromRemotive(profile) {
  const q = encodeURIComponent(profile.role);
  const data = await getJSON(`https://remotive.com/api/remote-jobs?search=${q}&limit=40`);
  return (data.jobs || []).map((j) => ({
    source: 'Remotive',
    preMatched: true, /* the board ran our role as its own query */
    title: clean(j.title),
    company: clean(j.company_name),
    location: clean(j.candidate_required_location) || 'Remote',
    type: clean(j.job_type),
    tags: (j.tags || []).slice(0, 8),
    url: j.url,
    posted: j.publication_date,
    /* Kept for scoring: fitness and ATS matching both read the posting's own
       words, and a title alone is not enough to judge either. */
    description: clean(j.description).slice(0, 4000),
    /*
     * And kept unflattened for the reader.
     *
     * `clean` removes the tags, which is right for keyword matching and
     * wrong for a person: it turns the responsibilities, the requirements
     * and the perks into one 4,000-character paragraph. The markup is where
     * the headings and the bullets are, so it travels alongside.
     */
    descriptionHtml: String(j.description || '').slice(0, 12000),
  }));
}

/* Jobicy — remote board with an open API, heavier on non-engineering roles
   than the others, which widens what a business or design student sees. */
async function fromJobicy(profile) {
  const data = await getJSON('https://jobicy.com/api/v2/remote-jobs?count=50');
  const terms = matchTerms(profile);
  return (data.jobs || [])
    .filter((j) => relevance(`${j.jobTitle || ''} ${(j.jobIndustry || []).join(' ')}`.toLowerCase(), terms).relevant)
    .slice(0, 30)
    .map((j) => ({
      source: 'Jobicy',
      title: clean(j.jobTitle),
      company: clean(j.companyName),
      location: clean(j.jobGeo) || 'Remote',
      type: (j.jobType || []).join(', ') || 'Remote',
      tags: (j.jobIndustry || []).slice(0, 8),
      url: j.url,
      posted: j.pubDate,
      description: clean(j.jobExcerpt).slice(0, 4000),
    }));
}

/* Himalayas — remote-first companies, published openly as JSON. */
async function fromHimalayas(profile) {
  const data = await getJSON('https://himalayas.app/jobs/api?limit=50');
  const terms = matchTerms(profile);
  return (data.jobs || [])
    .filter((j) => relevance(`${j.title || ''} ${(j.categories || []).join(' ')}`.toLowerCase(), terms).relevant)
    .slice(0, 30)
    .map((j) => ({
      source: 'Himalayas',
      title: clean(j.title),
      company: clean(j.companyName),
      location: (j.locationRestrictions || []).join(', ') || 'Remote',
      type: 'Remote',
      tags: (j.categories || []).slice(0, 8),
      url: j.applicationLink || j.url,
      posted: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
      description: clean(j.description).slice(0, 4000),
    }));
}

async function fromRemoteOK(profile) {
  const data = await getJSON('https://remoteok.com/api');
  const rows = Array.isArray(data) ? data.slice(1) : []; /* row 0 is their legal notice */
  const terms = matchTerms(profile);
  return rows
    .filter((j) => relevance(`${j.position || ''} ${(j.tags || []).join(' ')}`.toLowerCase(), terms).relevant)
    .slice(0, 40)
    .map((j) => ({
      source: 'RemoteOK',
      title: clean(j.position),
      company: clean(j.company),
      location: clean(j.location) || 'Remote',
      type: 'Remote',
      tags: (j.tags || []).slice(0, 8),
      url: j.url || j.apply_url,
      /* RemoteOK's apply_url redirects off-board — the direct-link resolver
         follows it to the employer instead of scraping the board page. */
      applyUrl: j.apply_url || null,
      posted: j.date,
      description: clean(j.description).slice(0, 4000),
    }));
}

async function fromArbeitnow(profile) {
  const data = await getJSON('https://www.arbeitnow.com/api/job-board-api');
  const terms = matchTerms(profile);
  return (data.data || [])
    .filter((j) => relevance(`${j.title || ''} ${(j.tags || []).join(' ')}`.toLowerCase(), terms).relevant)
    .slice(0, 40)
    .map((j) => ({
      source: 'Arbeitnow',
      title: clean(j.title),
      company: clean(j.company_name),
      location: clean(j.location) || (j.remote ? 'Remote' : ''),
      type: j.remote ? 'Remote' : (j.job_types || []).join(', '),
      tags: (j.tags || []).slice(0, 8),
      url: j.url,
      posted: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
      description: clean(j.description).slice(0, 4000),
    }));
}

/*
 * Freelancer projects — the gig lane, and the one the recording asked for.
 *
 * A freelance brief is an opening in its own right, and its project URL opens
 * the brief itself, exactly the way the Upwork job-detail link in the video
 * did. The skill allows these for the same reason: a /projects/ URL is the
 * posting, not a search over postings.
 */
async function fromFreelancer(profile) {
  const q = encodeURIComponent(profile.role);
  const data = await getJSON(
    `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${q}&limit=25&job_details=true&sort_field=time_updated`);
  const rows = (data && data.result && data.result.projects) || [];
  return rows
    .filter((p) => p.seo_url)
    .map((p) => ({
      source: 'Freelancer',
      title: clean(p.title),
      company: 'Freelance client',
      location: (p.currency && p.currency.country) || 'Remote',
      type: p.type === 'hourly' ? 'Hourly contract' : 'Fixed-price contract',
      tags: (p.jobs || []).map((j) => clean(j.name)).slice(0, 8),
      /* The brief itself — one click from here to the work. */
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      directUrl: `https://www.freelancer.com/projects/${p.seo_url}`,
      directKind: 'company',
      posted: p.time_submitted ? new Date(p.time_submitted * 1000).toISOString() : null,
      description: clean(p.preview_description).slice(0, 4000),
    }));
}

/*
 * WeWorkRemotely — remote roles, published as RSS with a link per listing.
 * Each link opens that job's own page, so no resolution is needed.
 */
async function fromWeWorkRemotely(profile) {
  const res = await httpFetch('https://weworkremotely.com/categories/remote-programming-jobs.rss', {
    headers: UA, timeoutMs: 7000,
  });
  if (!res.ok) throw new Error(String(res.status));
  const xml = await res.text();
  const terms = matchTerms(profile);

  return (xml.match(/<item>[\s\S]*?<\/item>/g) || [])
    .map((item) => {
      const pick = (tag) => {
        const m = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
        return m ? clean(m[1]) : '';
      };
      const title = pick('title');
      /* WWR titles read "Company: Role" — split so the table has both. */
      const [company, role] = title.includes(':')
        ? [title.split(':')[0].trim(), title.split(':').slice(1).join(':').trim()]
        : ['', title];
      return {
        source: 'WeWorkRemotely',
        title: role || title,
        company,
        location: pick('region') || 'Remote',
        type: pick('type') || 'Remote',
        tags: [],
        url: pick('link'),
        directUrl: pick('link'),
        directKind: 'company',
        posted: pick('pubDate') ? new Date(pick('pubDate')).toISOString() : null,
        description: pick('description').slice(0, 4000),
      };
    })
    .filter((j) => j.url && relevance(`${j.title} ${j.company}`.toLowerCase(), terms).relevant);
}

/* Hacker News "Who is hiring" — the monthly thread is where a lot of small
   companies post first, and Algolia indexes every comment publicly. */
async function fromHackerNews(profile) {
  /*
   * Searching all HN comments returned people describing their own side
   * projects and their PhDs — anything containing the word "engineer" — and
   * presented them as job openings. The monthly thread is the only part of HN
   * where a comment is reliably a real vacancy, so the search is scoped to it:
   * find the latest thread by the whoishiring account, then search inside it.
   */
  /*
   * By date, not by relevance.
   *
   * Algolia's relevance ranking answers "who is hiring" with a thread from
   * March 2020 — and every HN row this portal ever showed came out of it,
   * six-year-old jobs presented as current openings. The monthly thread is
   * only findable by asking for the newest, so that is what this asks for.
   * "Who wants to be hired" is the candidates' thread and is skipped.
   */
  const threads = await getJSON(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10'
  );
  const hiring = (threads.hits || [])
    .filter((h) => /who is hiring/i.test(h.title || '') && !/wants to be hired/i.test(h.title || ''))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (!hiring) return [];   /* no thread found: better nothing than noise */

  /*
   * A hundred, not twenty-five.
   *
   * This thread is where the recruiter contacts live — the posts that print
   * an email address to write to — and only a fraction of any month's posts
   * carry one. Fetching twenty-five comments, then keeping the top-level
   * ones, then keeping the recent ones with an address, left the Recruiters
   * section empty on most hunts. The thread holds forty-odd top-level posts
   * and roughly a quarter publish an address, so the pool has to start large
   * enough for that quarter to survive the filters.
   */
  const q = encodeURIComponent([profile.role.split(' ')[0], profile.skills[0] || ''].join(' ').trim());
  const data = await getJSON(
    `https://hn.algolia.com/api/v1/search?query=${q}&tags=comment,story_${hiring.objectID}&hitsPerPage=100`
  );

  return (data.hits || [])
    /* Top-level comments only. Replies are questions and salary arguments,
       not postings. */
    .filter((h) => h.comment_text && String(h.parent_id) === String(hiring.objectID))
    /* Posts that publish a way to reach a human come first, because those are
       the ones the Recruiters section is built from — capping at fifteen by
       arrival order threw most of them away before it ever saw them. */
    .sort((a, b) => {
      const has = (h) => (RE_CONTACT_EMAIL.test(h.comment_text) ? 1 : 0);
      return has(b) - has(a);
    })
    .slice(0, 30)
    .map((h) => {
      const body = clean(h.comment_text);
      const head = parseHiringPost(body);
      return {
        source: 'HN Who is Hiring',
        preMatched: true, /* Algolia searched the role for us */
        title: head.title,
        company: head.company || clean(h.author),
        location: head.location || (/remote/i.test(body) ? 'Remote' : ''),
        type: 'Direct post',
        tags: [],
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        posted: h.created_at,
        description: body.slice(0, 4000),
      };
    });
}

/*
 * Pull a company and a role out of a "Who is hiring" comment.
 *
 * These are free text, but the thread has a strong convention: the first line
 * reads "Company | Role | Location | Salary". Taking the first ninety
 * characters instead produced titles like "Location: Speyer, Germany (CET)
 * Remote: Yes, preferred Willing to relocate: No" — which then became the
 * subject line of a cold email, which is how a good tool starts looking
 * careless.
 */
const ROLE_WORDS = /(engineer|developer|designer|scientist|analyst|manager|architect|lead|intern|devops|sre|full[- ]stack|frontend|backend|data|security|product|qa|research)/i;

function parseHiringPost(body) {
  const firstLine = String(body || '').split(/\s{2,}|\n/)[0] || '';

  /* The pipe convention, when it is there. */
  if (firstLine.includes('|')) {
    const parts = firstLine.split('|').map((s) => s.trim()).filter(Boolean);
    const roleIdx = parts.findIndex((p) => ROLE_WORDS.test(p));
    if (roleIdx > 0) {
      return {
        company: parts[0].slice(0, 60),
        title: parts[roleIdx].slice(0, 80),
        location: (parts.find((p) => /remote|onsite|hybrid/i.test(p)) || '').slice(0, 40)
      };
    }
    if (parts.length >= 2) {
      return { company: parts[0].slice(0, 60), title: parts[1].slice(0, 80), location: '' };
    }
  }

  /*
   * Otherwise take the shortest fragment that names a role. Shortest matters:
   * a job title is two or three words, so picking the first match returned
   * whole sentences like "Pittsburgh, PA The Simon-Initiative at CMU is
   * building a learning engineering ecosystem" as the title.
   */
  const fragments = String(body || '')
    .split(/[.|·•\n,;]|\s{2,}|\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter((f) => f.length > 6 && f.length < 70 && ROLE_WORDS.test(f));

  if (fragments.length) {
    fragments.sort((a, b) => a.length - b.length);
    return { company: '', title: fragments[0].slice(0, 70), location: '' };
  }

  /* Nothing recognisable — say so rather than showing a wall of text. */
  return { company: '', title: 'Hiring post (see thread)', location: '' };
}

/* ── ranking against the resume ────────────────────────────────────────── */

function rank(jobs, profile) {
  const terms = matchTerms(profile);

  return jobs
    .map((j) => {
      const hay = `${j.title} ${j.tags.join(' ')} ${j.type} ${j.company}`.toLowerCase();
      const rel = relevance(hay, terms);
      /* Freshness and remoteness break ties between relevant jobs; they can
         never carry an irrelevant one to the top. */
      const fresh = j.posted ? Math.max(0, 30 - (Date.now() - new Date(j.posted).getTime()) / 86400000) / 30 : 0.3;
      const remote = /remote/i.test(`${j.location} ${j.type}`) ? 1 : 0;
      return {
        ...j,
        matched: rel.skillHits.slice(0, 6),
        /* A board we queried with the role has already done the matching;
           re-filtering its results on our narrower vocabulary threw away
           most of the good ones. */
        relevant: rel.relevant || j.preMatched === true,
        /* preMatched earns a listing its place, not a boost — otherwise a
           board's fuzzy match outranks a real skill match. */
        score: Math.round((rel.points + fresh * 2 + remote) * 10) / 10,
      };
    })
    .filter((j) => j.relevant)
    .sort((a, b) => b.score - a.score);
}

/* ── the platforms that need a login: aimed searches, not scraping ─────── */

function platformSearches(profile) {
  const role = profile.role;
  const roleQ = encodeURIComponent(role);
  const skills = profile.skills.slice(0, 4);
  const boolean = `${role} ${skills.length ? '(' + skills.join(' OR ') + ')' : ''}`.trim();
  const booleanQ = encodeURIComponent(boolean);
  const loc = profile.location === 'remote' ? 'Remote' : profile.location;
  const locQ = encodeURIComponent(loc);
  const expMap = { intern: '1', entry: '2', mid: '3', senior: '4' };

  return [
    {
      platform: 'LinkedIn',
      why: 'Boolean search with your stack, filtered to the last week and your experience level.',
      url: `https://www.linkedin.com/jobs/search/?keywords=${booleanQ}&location=${locQ}&f_TPR=r604800&f_E=${expMap[profile.seniority] || '2'}`,
    },
    {
      platform: 'Google Jobs',
      why: "Google's aggregated index — pulls postings from company career pages other boards miss.",
      url: `https://www.google.com/search?q=${booleanQ}+jobs+${locQ}&ibp=htl;jobs`,
    },
    {
      platform: 'Google x-ray → LinkedIn',
      why: 'Searches LinkedIn job pages directly through Google, past the login wall.',
      url: `https://www.google.com/search?q=site:linkedin.com/jobs+${booleanQ}+${locQ}`,
    },
    {
      platform: 'Upwork',
      why: 'Freelance contracts matching your stack, newest first.',
      url: `https://www.upwork.com/nx/search/jobs/?q=${booleanQ}&sort=recency`,
    },
    {
      platform: 'Fiverr',
      why: 'Buyer requests and gig categories for what you can already deliver.',
      url: `https://www.fiverr.com/search/gigs?query=${roleQ}&source=top-bar`,
    },
    {
      platform: 'Naukri',
      why: 'The largest India board — role and location pre-filled.',
      url: `https://www.naukri.com/${role.replace(/\s+/g, '-')}-jobs-in-${String(loc).replace(/\s+/g, '-').toLowerCase()}`,
    },
    {
      platform: 'Indeed',
      why: 'Aggregates agency and direct postings, sorted by date.',
      url: `https://in.indeed.com/jobs?q=${booleanQ}&l=${locQ}&sort=date`,
    },
    {
      platform: 'Wellfound',
      why: 'Startup roles that hire on skills rather than years of experience.',
      url: `https://wellfound.com/role/r/${role.replace(/\s+/g, '-').toLowerCase()}`,
    },
    {
      platform: 'Internshala',
      why: 'Internships — the fastest first rung if you are still studying.',
      url: `https://internshala.com/internships/${role.replace(/\s+/g, '-').toLowerCase()}-internship`,
    },
    {
      platform: 'Freelancer',
      why: 'Contract projects matching your stack, bid directly.',
      url: `https://www.freelancer.com/jobs/?keyword=${roleQ}`,
    },
    {
      platform: 'Unstop',
      why: 'Competitions, internships and fresher roles across Indian campuses.',
      url: xray('unstop.com', role, skills, loc),
    },

    /*
     * The Indian boards below are reached the same way: a Google site: query
     * rather than a scrape. Each one hides its listings behind a login or a
     * paywall, so an x-ray search is what actually lands a student on real
     * results — and it stays inside what the platform publishes to Google.
     */
    {
      platform: 'Instahyre',
      why: 'Curated product-company roles — usually the strongest India listings.',
      url: xray('instahyre.com', role, skills, loc),
    },
    {
      platform: 'Cutshort',
      why: 'Startups hiring on skill tests rather than CVs.',
      url: xray('cutshort.io', role, skills, loc),
    },
    {
      platform: 'Hirist',
      why: 'Tech-only board — less noise than the general ones.',
      url: xray('hirist.tech', role, skills, loc),
    },
    {
      platform: 'Foundit (Monster)',
      why: 'Legacy MNC listings that never reach the newer boards.',
      url: xray('foundit.in', role, skills, loc),
    },
    {
      platform: 'Shine',
      why: 'HT-owned portal, strong on non-metro postings.',
      url: xray('shine.com', role, skills, loc),
    },
    {
      platform: 'TimesJobs',
      why: 'Times group board — heavy on service companies hiring in bulk.',
      url: xray('timesjobs.com', role, skills, loc),
    },
    {
      platform: 'Glassdoor',
      why: 'Postings alongside salary data and company reviews.',
      url: xray('glassdoor.co.in/job', role, skills, loc),
    },
    {
      platform: 'WeWorkRemotely',
      why: 'Remote roles paid in USD or EUR.',
      url: xray('weworkremotely.com', role, skills, ''),
    },
  ];
}

/**
 * A Google site: search against one board.
 *
 * Quoted phrases matter: unquoted, Google widens the terms until a "react
 * developer" search returns anything mentioning either word.
 */
function xray(site, role, skills, loc) {
  const quoted = (s) => `"${String(s).replace(/"/g, '')}"`;
  const parts = [`site:${site}`, quoted(role)];
  if (skills && skills.length) parts.push(`(${skills.slice(0, 3).map(quoted).join(' OR ')})`);
  if (loc && String(loc).toLowerCase() !== 'remote') parts.push(quoted(loc));
  return `https://www.google.com/search?q=${encodeURIComponent(parts.join(' '))}`;
}

/* ── routes ────────────────────────────────────────────────────────────── */

async function textFromUpload(file) {
  if (!file) return '';
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse');
    return (await pdfParse(file.buffer)).text || '';
  }
  return file.buffer.toString('utf8');
}

router.post('/profile', upload.single('file'), async (req, res) => {
  try {
    const b = bodyOf(req);
    const text = (await textFromUpload(req.file)) || b.text || '';
    if (!text.trim()) return res.status(400).json({ ok: false, error: 'Attach your resume or paste its text.' });
    res.json({ ok: true, profile: profileFromResume(text) });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not read that file. Try a text-based PDF or paste the text.' });
  }
});

/*
 * The hunt. Every source is raced with its own timeout and its own failure —
 * one board being down must not cost the student the other three.
 */
router.post('/search', upload.single('file'), async (req, res) => {
  try {
    const b = bodyOf(req);
    let profile;
    let resumeSource = b.resumeText || b.text || '';
    if (b.profile) {
      profile = typeof b.profile === 'string' ? JSON.parse(b.profile) : b.profile;
    } else {
      const text = (await textFromUpload(req.file)) || b.text || '';
      if (!text.trim()) return res.status(400).json({ ok: false, error: 'Attach your resume or paste its text.' });
      resumeSource = text;
      profile = profileFromResume(text);
    }
    if (b.role) profile.role = b.role;
    if (b.location) profile.location = b.location;

    /*
     * Company ATS boards join the aggregators. Their rows arrive with the
     * employer's own apply URL already attached — nothing to resolve — and
     * they live on different hosts, so they still answer on a day when every
     * aggregator is blocked. That was the "0 openings" the recording showed.
     */
    const boardTerms = matchTerms(profile);
    /* The target role and everything a recruiter would consider equivalent. */
    const family = roleFamily(profile.role);
    const boardMatch = (row) =>
      relevance(`${row.title} ${row.tags.join(' ')} ${row.location}`.toLowerCase(), boardTerms).relevant;

    const settled = await Promise.allSettled([
      fromRemotive(profile),
      fromRemoteOK(profile),
      fromArbeitnow(profile),
      fromHackerNews(profile),
      fromJobicy(profile),
      fromHimalayas(profile),
      fromFreelancer(profile),
      fromWeWorkRemotely(profile),
      atsBoards.huntBoards(boardMatch, {
        budgetMs: 6000,
        perBoard: 4,
        /* Rotate the window so the roster is covered across sessions. */
        offset: Math.floor(Date.now() / 3600000),
      }),
    ]);

    const names = ['Remotive', 'RemoteOK', 'Arbeitnow', 'HN Who is Hiring', 'Jobicy', 'Himalayas',
      'Freelancer', 'WeWorkRemotely', 'Company ATS boards'];
    const sources = settled.map((s, i) => ({
      name: names[i],
      ok: s.status === 'fulfilled',
      count: s.status === 'fulfilled' ? s.value.length : 0,
      error: s.status === 'rejected' ? String(s.reason && s.reason.message || s.reason).slice(0, 60) : null,
    }));

    const all = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
    /* the same role is often syndicated to two boards */
    const seen = new Set();
    const deduped = all.filter((j) => {
      const key = `${j.title}|${j.company}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    /*
     * The agent's memory joins the hunt: every opening seen on an earlier
     * pass that this one has not refound, marked with its age. When every
     * board fails at once — an outage, blocked egress — the memory IS the
     * answer, rather than "0 openings" from an agent that has seen hundreds.
     */
    const boardsAllDown = sources.every((s) => !s.ok);
    const remembered = jobCache.recall(seen);
    remembered.forEach((j) => deduped.push(j));

    /*
     * Scored, not just sorted. Relevance decides whether a listing belongs in
     * the list at all; fitness answers the question the student is actually
     * asking, which is whether it is worth their evening to apply.
     */
    const resumeText = resumeSource;
    /* Six months is the window; older is presumed filled and never shown. */
    const inWindow = deduped.filter((j) => {
      const age = ageOf(j.posted);
      return age.days === null || age.days <= MAX_POSTING_DAYS;
    });
    const scored = rank(inWindow, profile).slice(0, 40).map((job) => ({
      ...job,
      jobId: jobIdOf(job),
      stale: isStale(job.posted),
      postedAgo: ageOf(job.posted).label,
      fit: fitness(profile, job),
      ats: resumeText
        ? atsMatch(resumeText, `${job.title} ${job.description || ''}`, profile.skills, job.title)
        : null,
    }));

    /* Best fit first. Two postings with the same fit fall back to freshness
       and keyword strength, which is what `score` already carries. */
    /*
     * Ordered by fit discounted for how much evidence it rests on.
     *
     * Confidence as a pure tiebreak was not enough: a posting scoring 71% on
     * two weak signals still outranked a Senior Frontend Developer role
     * scoring 58% on nearly every dimension — and the second is plainly the
     * better lead. Folding confidence into the sort keeps fit dominant while
     * stopping a vague posting from buying the top slot cheaply.
     */
    const ordering = (j) => j.fit.percent * (0.6 + 0.4 * ((j.fit.confidence || 0) / 100));
    scored.sort((a, b2) => (ordering(b2) - ordering(a)) || (b2.score - a.score));

    /* Dead links removed before the student sees them. Opt out with
       verify=0 when speed matters more than accuracy. */
    const live = b.verify === '0' || b.verify === false
      ? scored
      : await verifyLinks(scored);

    /*
     * The job-hunt-agent skill's core rule: the link must land on the job —
     * the employer's careers page or ATS — not the board that listed it. The
     * top of the ranking gets resolved inside a time budget; whatever the
     * budget cannot reach keeps its board job URL, labelled `via <board>`,
     * and fit is also expressed 1–5 as the skill's table prints it.
     */
    if (!(b.resolve === '0' || b.resolve === false)) {
      /* The listing text first, for every row — an HN post carries its
         Greenhouse link in the body, and reading it costs no network. */
      live.forEach((j) => {
        if (j.directUrl || !j.description) return;
        const inText = directLink.extractApplyLink(j.description, j.url);
        if (inText) { j.directUrl = inText.url; j.directKind = inText.kind; }
      });
      /*
       * Budgeted for a person watching a spinner, not for completeness. A
       * recording showed "Hunting…" running past thirty seconds: six board
       * fetches, then link verification, then fifteen seconds of resolution,
       * all before a single row appeared. The text scan above is free and
       * catches most of them; the network pass now gets six seconds over the
       * top eight rows, and whatever it misses stays a labelled board link
       * rather than holding up the answer.
       */
      await directLink.resolveBatch(live.filter((j) => !j.directUrl).slice(0, 8), { budgetMs: 6000 });

      /* Direct openings are the product; they lead. Within each group the
         fit ordering stands unchanged. */
      live.sort((a, j2) => (j2.directUrl ? 1 : 0) - (a.directUrl ? 1 : 0) || (ordering(j2) - ordering(a)));
    }

    /* This hunt feeds the memory the next one reads — resolved links included. */
    jobCache.remember(live.filter((j) => !j.fromCache));

    /*
     * Direct links only, by default.
     *
     * Asked for repeatedly and correctly: a row whose link opens a board
     * search page is not an opening, it is homework. Only rows that land on
     * the employer's own posting survive — company ATS boards supply most of
     * them by construction, resolution supplies the rest. Pass directOnly=0
     * to see the board-listed remainder too.
     */
    const directOnly = !(b.directOnly === '0' || b.directOnly === false);
    const shown = directOnly ? live.filter((j) => j.directUrl) : live;
    const withheld = live.length - shown.length;
    live.forEach((j) => {
      j.fit5 = Math.max(1, Math.min(5, Math.round((j.fit.percent || 0) / 20)));
      j.linkLabel = j.directUrl
        ? (j.directKind === 'ats' ? 'Apply — company ATS' : 'Apply — company site')
        : `Opening via ${j.source}`;
    });

    res.json({
      ok: true,
      profile,
      /* Returned so the client can write materials for any listing without
         asking for the file again — a PDF was parsed here, not in the
         browser, so this is the only copy of the text it has. */
      resumeText: resumeText.slice(0, 30000),
      jobs: shown,
      withheld,
      /*
       * Recruiters who published a way to reach them in their own advert.
       *
       * Read from every posting the hunt fetched, not only the ones that
       * survived fit ranking. A hiring manager who wrote "send me your CV at
       * …" is worth knowing about even when that particular role scored two
       * out of five — the contact is a door, not a recommendation, and
       * filtering it away with the job was throwing out the thing being
       * asked for.
       */
      recruiters: recruiterContacts.collectRecruiters(
        deduped
          /*
           * Six weeks, and only postings for the work this person does.
           *
           * A recruiter list is a list of people to write to today, so two
           * filters apply that the openings table does not need. Age is the
           * first: past six weeks the advert is stale and the reply rate with
           * it. Relevance is the second — a student who uploaded a full-stack
           * resume should not be handed the email address of someone hiring a
           * radiographer. Both are judged the same way the openings are, so
           * the two lists agree about what this person is looking for.
           */
          .filter((j) => {
            const a = ageOfContact(j.posted);
            if (a.days !== null && a.days > RECRUITER_MAX_DAYS) return false;
            /*
             * Matched on what the advert is FOR, not on everything it says.
             *
             * Scanning the whole body sent a Social Selling internship to a
             * data analyst because the text mentioned SQL once. Matching the
             * title alone went too far the other way: a Hacker News post has
             * no title field, only the first line of a comment, so the rows
             * that actually carry contacts all disappeared.
             *
             * The role is stated in the title and in the opening of the post —
             * "Company | Senior Backend Engineer | Remote" — so that is the
             * span that has to match, and the requirements paragraph three
             * screens down does not get a vote.
             */
            const roleSpan = `${j.title || ''} ${(j.tags || []).join(' ')} ${String(j.description || '').slice(0, 220)}`
              .toLowerCase();

            /*
             * The target role, or one a recruiter would treat as the same
             * hiring pool. Nothing else: the general relevance fallback let a
             * "Maintenance and Grounds Officer" reach a DevOps profile
             * because a single word overlapped somewhere in the opening
             * paragraph. A recruiter list is a list of people to write to
             * about your own job, so a near-miss is worse than a short list.
             */
            if (family.some((r) => roleSpan.includes(r))) return true;

            /* Or an advert whose named skills are substantially this person's
               stack — two or more, so one shared word cannot carry it. */
            const skillHits = (profile.skills || [])
              .filter((s) => hasWord(roleSpan, s)).length;
            return skillHits >= 2;
          })
          .map((j) => ({ ...j, postedAgo: ageOfContact(j.posted).label }))),
      counts: {
        total: shown.length,
        strong: shown.filter((j) => j.fit.band === 'strong').length,
        moderate: shown.filter((j) => j.fit.band === 'moderate').length,
        stretch: shown.filter((j) => j.fit.band === 'stretch').length,
        deadLinksDropped: scored.length - live.length,
        fromMemory: shown.filter((j) => j.fromCache).length,
        withheldNoDirectLink: withheld,
      },
      /* Said plainly when the boards were unreachable and memory answered. */
      cacheNote: boardsAllDown && live.some((j) => j.fromCache)
        ? 'The live boards were unreachable this pass — these are the openings from earlier hunts, each marked with when it was seen.'
        : null,
      sources,
      searches: platformSearches(profile),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'The hunt failed to start. Try again in a moment.' });
  }
});

/**
 * A stable id for a listing, so the same job found twice is the same row.
 * Boards that publish their own id keep it; the rest get one derived from the
 * company and title, which is what the student would otherwise write down.
 */
function jobIdOf(job) {
  const fromUrl = String(job.url || '').match(/(?:jobs?|view|posting)[/-](\d{6,})/i);
  if (fromUrl) return `${job.source.replace(/\s+/g, '')}-${fromUrl[1]}`;
  const short = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 14);
  return [job.source.replace(/\s+/g, ''), short(job.company), short(job.title)].filter(Boolean).join('-');
}

/**
 * Confirm the links actually go somewhere.
 *
 * Boards keep serving listings after the role is filled, so a search that
 * looks full can be half dead ends. Each URL is checked once, and only a
 * definite refusal — 404 or 410 — removes a listing. A timeout or a 403 does
 * not: plenty of sites block automated HEAD requests while serving the page
 * perfectly well to a browser, and dropping those would throw away good jobs.
 *
 * Checks run in small batches so a slow board cannot hold up the response.
 */
async function verifyLinks(jobs, budgetMs = 4000) {
  const deadline = Date.now() + budgetMs;
  const BATCH = 8;

  /* A row that came from a company's own ATS API is already proven — the
     board would not have returned it otherwise. Spending a HEAD request on it
     buys nothing and costs the student seconds of spinner. It is skipped from
     CHECKING, not from the results: filtering the working list here would
     have deleted every company posting from the answer. */
  const toCheck = jobs.filter((j) => !(j.directKind === 'ats' && j.directUrl));

  for (let i = 0; i < toCheck.length; i += BATCH) {
    if (Date.now() > deadline) break;   // whatever is unchecked stays in, unmarked

    await Promise.all(toCheck.slice(i, i + BATCH).map(async (job) => {
      if (!job.url) { job.linkChecked = false; return; }
      try {
        const res = await httpFetch(job.url, {
          method: 'HEAD', headers: UA, redirect: 'follow',
          timeoutMs: 3000
        });
        job.linkChecked = true;
        job.linkStatus = res.status;
        job.linkDead = res.status === 404 || res.status === 410;
      } catch (e) {
        /* Unreachable from here is not proof the posting is gone. */
        job.linkChecked = false;
      }
    }));
  }

  return jobs.filter((j) => !j.linkDead);
}

/** Postings over 30 days old are usually filled; worth a warning, not a hide. */
function isStale(posted) {
  if (!posted) return false;
  const when = new Date(posted).getTime();
  if (!when || Number.isNaN(when)) return false;
  return (Date.now() - when) / 86400000 > 30;
}

/*
 * The window is six months, and every row says where in it it sits. A student
 * asked for older vacancies too — weeks, months back — and the honest way to
 * include them is with their age on the card, so "2 months ago" is a choice
 * the reader makes, not a surprise the interview reveals. Past six months a
 * posting is presumed gone and does not appear at all.
 */
const MAX_POSTING_DAYS = 183;

function ageOf(posted) {
  if (!posted) return { days: null, label: 'date unknown' };
  const when = new Date(posted).getTime();
  if (!when || Number.isNaN(when)) return { days: null, label: 'date unknown' };
  const days = Math.max(0, Math.floor((Date.now() - when) / 86400000));
  if (days <= 7) return { days, label: 'this week' };
  if (days <= 13) return { days, label: 'last week' };
  if (days <= 56) return { days, label: `${Math.round(days / 7)} weeks ago` };
  const months = Math.max(2, Math.round(days / 30));
  return { days, label: `${months} months ago` };
}

/*
 * A contact goes cold far faster than a posting does. Six weeks is the
 * outside edge of a recruiter still recognising the advert you are answering,
 * so the recruiter list stops there rather than at the openings' six months —
 * and it counts in hours, days and weeks, never months, because "3 days ago"
 * is the difference between writing today and not bothering.
 */
const RECRUITER_MAX_DAYS = 42;

function ageOfContact(posted) {
  if (!posted) return { days: null, label: '' };
  const when = new Date(posted).getTime();
  if (!when || Number.isNaN(when)) return { days: null, label: '' };

  const ms = Math.max(0, Date.now() - when);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);

  if (hours < 1) return { days, label: 'just now' };
  if (hours < 24) return { days, label: `${hours} hour${hours === 1 ? '' : 's'} ago` };
  if (days < 7) return { days, label: `${days} day${days === 1 ? '' : 's'} ago` };
  const weeks = Math.round(days / 7);
  return { days, label: `${weeks} week${weeks === 1 ? '' : 's'} ago` };
}

/*
 * Materials for one posting. Given the resume and the job, returns a tailored
 * resume and a cover letter aimed at it — plus, honestly, the gap list of
 * things the posting wanted that the resume cannot support.
 */
router.post('/materials', upload.single('file'), async (req, res) => {
  try {
    const b = bodyOf(req);
    const resumeText = (await textFromUpload(req.file)) || b.resumeText || b.text || '';
    if (!resumeText.trim()) {
      return res.status(400).json({ ok: false, error: 'Attach your resume or paste its text.' });
    }

    let job = b.job;
    if (typeof job === 'string') job = JSON.parse(job);
    if (!job || !job.title) {
      return res.status(400).json({ ok: false, error: 'Pick a job first.' });
    }

    let profile = b.profile;
    if (typeof profile === 'string') profile = JSON.parse(profile);
    if (!profile) profile = profileFromResume(resumeText);

    res.json({
      ok: true,
      job: { title: job.title, company: job.company, url: job.url },
      fit: fitness(profile, job),
      resume: tailorResume(profile, job, resumeText),
      coverLetter: coverLetter(profile, job, resumeText),
      coldEmail: coldEmail(profile, job, resumeText, {
        hiringManager: b.hiringManager || '',
        phone: b.phone || '',
        ask: b.ask || ''
      }),
      /* The formal application mail in the job-hunt skill's shape — draft
         only, and the To: is never guessed. */
      hrEmail: hrEmail(profile, job, resumeText, {
        to: b.to || '', phone: b.phone || '', email: b.email || '',
        link: b.link || '', status: b.status || ''
      }),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not build the documents. Try pasting the resume text.' });
  }
});

/*
 * "Is this real / get me the employer page" for one listing — the skill's
 * resolve command. Returns the direct URL when one can be proven, and says
 * so plainly when only the board's listing is live.
 */
router.post('/resolve', async (req, res) => {
  try {
    const b = bodyOf(req);
    const url = String(b.url || '');
    if (!/^https?:\/\//.test(url)) {
      return res.status(400).json({ ok: false, error: 'Send the listing URL.' });
    }
    const direct = await directLink.resolveDirectUrl({ url }, { timeoutMs: 8000 });
    return res.json({
      ok: true,
      input: url,
      direct: direct ? direct.url : null,
      kind: direct ? direct.kind : null,
      note: direct
        ? (direct.kind === 'ats' ? 'Company ATS posting — this is the job itself.' : 'Employer page found.')
        : 'No employer page could be proven from here — the board listing is the live opening. Apply there.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Could not resolve that URL.' });
  }
});

/**
 * A job advert, turned from markup into readable lines.
 *
 * Boards send HTML. Stripping every tag gives one long paragraph in which
 * the responsibilities, the requirements and the perks are indistinguishable
 * — and those headings are exactly what a candidate reads to decide, and
 * what the tailor reads to match. The tags that carry structure become
 * structure; everything else goes.
 */
function postingText(html) {
  return String(html || '')
    /* Block ends become line breaks before the tags are removed. */
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    /* A list item is a bullet, and a heading is a heading. */
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<(h[1-6]|strong|b)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    /* Three blank-ish lines in a row is the markup's spacing, not the
       author's paragraphs. */
    .filter((l, i, arr) => l !== arr[i - 1])
    .join('\n')
    .slice(0, 4000);
}

/**
 * The same hunt, callable in process.
 *
 * The resume agent asks for openings now, and the only way to reach this
 * search was an HTTP request to our own port — a hop that depends on knowing
 * where the server is listening in order to talk to code in the same module
 * graph. The boards, the dedupe and the ranking are already written; this
 * exposes them.
 */
async function findJobs(resumeText, opts = {}) {
  const profile = profileFromResume(String(resumeText || ''));
  if (opts.role) profile.role = opts.role;
  if (opts.location) profile.location = opts.location;

  const boardTerms = matchTerms(profile);
  const family = roleFamily(profile.role);
  const boardMatch = (row) =>
    relevance(`${row.title} ${(row.tags || []).join(' ')} ${row.location}`.toLowerCase(), boardTerms).relevant;

  const settled = await Promise.allSettled([
    fromRemotive(profile),
    fromRemoteOK(profile),
    fromArbeitnow(profile),
    fromJobicy(profile),
    fromHimalayas(profile),
    fromWeWorkRemotely(profile),
    atsBoards.huntBoards(boardMatch, { budgetMs: 6000, perBoard: 4, offset: Math.floor(Date.now() / 3600000) }),
  ]);

  const all = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  const seen = new Set();
  return all
    /* A row without a destination is not a result; it is the absence of one. */
    .filter((j) => /^https?:\/\//.test(String(j.url || j.applyUrl || '')))
    /*
     * The title has to be the job they do, not merely contain "engineer".
     *
     * The aggregators return their whole feed, and matching on any role word
     * put "Laborer", "COSTING ENGINEER" and "Maintenance and Grounds Officer"
     * in front of a DevOps engineer — real openings, correctly linked, and
     * nothing to do with them. So the title must carry either the role family
     * or one of the tools they actually use. A list you have to read past is
     * worse than a shorter one.
     */
    /*
     * Mostly the role they asked for, and a couple they could actually get.
     *
     * Two failure modes sit either side of this. Filter on the exact title
     * and a backend engineer never sees the platform and full-stack roles
     * they would walk into; filter loosely and the first result is "SaaS
     * Product Support Jedi" because a tag matched. So the list is graded:
     * the title carrying the distinctive word is an exact match, a title in
     * an adjacent family that also shares several of their tools is a
     * stretch worth showing, and everything else is noise.
     *
     * Nine in ten are the role they named. The last one is the door they did
     * not know was open.
     */
    .map((j) => {
      const title = String(j.title || '').toLowerCase();
      const hay = `${title} ${(j.tags || []).join(' ')}`.toLowerCase();

      /* "Engineer", "developer" and "analyst" are in every posting in the
         industry; what separates a backend role from a data one is the word
         "backend". */
      const GENERIC = new Set(['engineer', 'developer', 'analyst', 'scientist', 'manager', 'specialist', 'senior', 'lead', 'staff', 'principal']);
      const distinctive = family.filter((w) => w.length > 3 && !GENERIC.has(w));
      const exact = distinctive.length
        ? distinctive.some((w) => title.includes(w))
        : family.some((w) => w.length > 3 && title.includes(w));

      /* A stretch has to be a real role in a neighbouring family AND carry
         enough of their stack that they could do it — one shared tag is a
         coincidence, three is a qualification. */
      const skillHits = (profile.skills || []).filter((s) => s.length > 2 && hay.includes(String(s).toLowerCase())).length;
      const adjacentTitle = /\b(full[- ]?stack|platform|infrastructure|devops|sre|site reliability|software|architect|api|integration|cloud)\b/.test(title);
      const stretch = !exact && adjacentTitle && skillHits >= 3;

      return { j, exact, stretch, skillHits };
    })
    .filter((r) => r.exact || r.stretch)
    /* Exact first, then the stretches — and within each, the ones matching
       more of their stack. */
    .sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || b.skillHits - a.skillHits)
    .filter((r, i, all) => {
      /* One in ten is a stretch, and at least one whenever any exists — a
         list of eight that is all stretches is not a search result. */
      if (r.exact) return true;
      const exactCount = all.filter((x) => x.exact).length;
      const stretchesBefore = all.slice(0, i).filter((x) => !x.exact).length;
      return stretchesBefore < Math.max(1, Math.round(exactCount / 9));
    })
    .map((r) => r.j)
    .filter((j) => {
      const key = `${j.title}|${j.company}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, opts.limit || 8)
    .map((j) => ({
      title: String(j.title || '').slice(0, 90),
      company: String(j.company || '').slice(0, 60),
      location: String(j.location || '').slice(0, 60),
      url: String(j.url || j.applyUrl),
      /*
       * The posting's own words travel with the row.
       *
       * Deciding to tailor for a job means reading it first, and a title and
       * a company name are not a job description — without this the student
       * is choosing between eight strings. Tags come along because they are
       * what the tailor will actually match against.
       */
      /*
       * The posting keeps its shape.
       *
       * Flattening the HTML to one paragraph gave back a 2,500-character
       * wall — the responsibilities, the requirements and the benefits run
       * together, which is unreadable and is also where the tailor's keywords
       * live. Boards send <h3>, <ul> and <li>; turning those into headings
       * and bullet lines keeps the structure a reader needs without trusting
       * any markup to the page.
       */
      description: postingText(j.descriptionHtml || j.description || j.summary || ''),
      tags: Array.isArray(j.tags) ? j.tags.slice(0, 12) : [],
      /* What a job card shows besides the title: how old the posting is, what
         it pays if the board said, and the first line of what the work is. */
      posted: j.posted || null,
      salary: String(j.salary || j.compensation || '').slice(0, 60) || null,
      type: String(j.type || '').slice(0, 40) || null,
      snippet: postingText(j.descriptionHtml || j.description || '')
        .split('\n')
        .find((l) => l.length > 40) || '',
    }));
}

module.exports = router;
module.exports.findJobs = findJobs;
module.exports.profileFromResume = profileFromResume;
module.exports.jobIdOf = jobIdOf;
module.exports.ageOfContact = ageOfContact;
module.exports.RECRUITER_MAX_DAYS = RECRUITER_MAX_DAYS;
module.exports.isStale = isStale;
module.exports.xray = xray;
module.exports.platformSearches = platformSearches;
module.exports.rank = rank;
