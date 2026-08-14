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
const router = express.Router();
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
router.use(express.urlencoded({ extended: true, limit: '2mb' }));

const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

/* ── reading the resume into a search profile ───────────────────────────── */

const SKILL_VOCAB = [
  'javascript','typescript','react','next.js','node','express','mongodb','mongoose','redux','graphql',
  'python','django','flask','fastapi','pandas','numpy','scikit-learn','tensorflow','pytorch','nlp',
  'java','spring','spring boot','hibernate','kotlin','android','swift','ios','flutter','dart',
  'html','css','tailwind','sass','figma','ui/ux','accessibility',
  'sql','postgresql','mysql','redis','elasticsearch','kafka',
  'aws','azure','gcp','docker','kubernetes','terraform','jenkins','ci/cd','linux','bash','git',
  'cyber security','penetration testing','owasp','siem','soc','networking','cryptography',
  'excel','power bi','tableau','financial modelling','valuation','market research','stakeholder management',
  'recruitment','onboarding','payroll','hris','content writing','seo','social media',
  'machine learning','deep learning','data analysis','data visualization','rest api','microservices','testing','jest',
];

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
  ['hr executive', ['human resource','hr executive','recruiter','talent acquisition']],
];

const SENIORITY = [
  ['intern', ['intern','internship','trainee']],
  ['entry', ['fresher','graduate','entry level','junior','jr.']],
  ['mid', ['3+ years','4 years','mid-level','associate']],
  ['senior', ['senior','sr.','lead','principal','architect','manager']],
];

const INDIAN_CITIES = ['bengaluru','bangalore','hyderabad','pune','mumbai','delhi','noida','gurgaon','gurugram','chennai','kolkata','ahmedabad','jaipur','indore','bhubaneswar','remote'];

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
    role = guess ? guess[0] : (skills.includes('react') || skills.includes('node') ? 'full stack developer' : 'software engineer');
  }

  let seniority = 'entry';
  for (const [level, hints] of SENIORITY) if (hints.some((h) => low.includes(h))) seniority = level;

  const location = INDIAN_CITIES.find((c) => low.includes(c)) || 'remote';
  /* \s matches newlines, so the original anchor ran past the end of the line
     and captured the job title with the name. Horizontal space only. */
  const name = (raw.match(/^[ \t]*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,3})[ \t]*$/m) || [])[1] || null;

  return { name, role, seniority, location, skills: skills.slice(0, 18), keywordCount: skills.length };
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

async function getJSON(url, ms = 9000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
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
      posted: j.date,
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
    }));
}

/* Hacker News "Who is hiring" — the monthly thread is where a lot of small
   companies post first, and Algolia indexes every comment publicly. */
async function fromHackerNews(profile) {
  const q = encodeURIComponent([profile.role.split(' ')[0], profile.skills[0] || ''].join(' ').trim());
  const data = await getJSON(`https://hn.algolia.com/api/v1/search?query=${q}&tags=comment&hitsPerPage=25`);
  return (data.hits || [])
    .filter((h) => h.comment_text && /hiring|remote|apply|role|engineer|developer/i.test(h.comment_text))
    .slice(0, 15)
    .map((h) => {
      const body = clean(h.comment_text);
      return {
        source: 'HN Who is Hiring',
        preMatched: true, /* Algolia searched the role for us */
        title: body.slice(0, 90) + (body.length > 90 ? '…' : ''),
        company: clean(h.author),
        location: /remote/i.test(body) ? 'Remote' : '',
        type: 'Direct post',
        tags: [],
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        posted: h.created_at,
      };
    });
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
  ];
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
    if (b.profile) {
      profile = typeof b.profile === 'string' ? JSON.parse(b.profile) : b.profile;
    } else {
      const text = (await textFromUpload(req.file)) || b.text || '';
      if (!text.trim()) return res.status(400).json({ ok: false, error: 'Attach your resume or paste its text.' });
      profile = profileFromResume(text);
    }
    if (b.role) profile.role = b.role;
    if (b.location) profile.location = b.location;

    const settled = await Promise.allSettled([
      fromRemotive(profile),
      fromRemoteOK(profile),
      fromArbeitnow(profile),
      fromHackerNews(profile),
    ]);

    const names = ['Remotive', 'RemoteOK', 'Arbeitnow', 'HN Who is Hiring'];
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

    res.json({
      ok: true,
      profile,
      jobs: rank(deduped, profile).slice(0, 40),
      sources,
      searches: platformSearches(profile),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'The hunt failed to start. Try again in a moment.' });
  }
});

module.exports = router;
module.exports.profileFromResume = profileFromResume;
module.exports.platformSearches = platformSearches;
module.exports.rank = rank;
