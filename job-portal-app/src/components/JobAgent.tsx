import { useEffect, useRef, useState } from 'react';
import KineticGrid from './KineticGrid';

/*
 * The job agent's screen. The kinetic grid is the background; everything the
 * student needs sits on top of it.
 *
 * The panel is honest about where a result came from: LIVE listings are real
 * postings pulled from boards with a public API, AIMED cards are one-click
 * searches composed from the resume for platforms that need a login and
 * cannot be scraped without breaking their terms.
 */

const API = '/api/v2/jobs';

/* A refusal the server worded (sign in, get the portal) is shown as it is. */
class Said extends Error {}
const inter = { fontFamily: "'Inter', sans-serif" };

/*
 * The application tracker, per the job-hunt skill's fit-and-track.md: one row
 * per opening, never a duplicate URL. Saved to the student's account
 * (/api/v2/jobs/tracker), so a phone and a laptop see the same rows and the
 * resume portal can add to them. Rows this browser kept before are brought
 * across once. An application sent starts the clock on the drafted day-4 and
 * day-10 follow-ups.
 */
type TrackStatus = 'found' | 'tailored' | 'emailed' | 'applied' | 'interview' | 'offer' | 'closed';
type FollowUp = { afterDays: number; subject: string; body: string };
type TrackRow = {
  date: string; company: string; role: string; url: string;
  fit: number; status: TrackStatus; notes: string;
  to?: string; followUps?: FollowUp[]; appliedAt?: string | null; followUpsSent?: number[];
};
const TRACKER_KEY = 'ten_job_tracker';
const TRACK_STATUSES: TrackStatus[] = ['found', 'tailored', 'emailed', 'applied', 'interview', 'offer', 'closed'];
/* The two portals hand a job or a resume to each other through the browser. */
const HANDOFF_JOB = 'ten_handoff_job';
const HANDOFF_RESUME = 'ten_handoff_resume';
/* Follow-ups that are due and not marked sent. */
const dueFollowUps = (r: TrackRow): FollowUp[] => (r.appliedAt && (r.status === 'applied' || r.status === 'emailed')
  ? (r.followUps || []).filter((f) => Date.now() - new Date(r.appliedAt as string).getTime() >= f.afterDays * 86400000
    && !(r.followUpsSent || []).includes(f.afterDays))
  : []);

/**
 * Remote or onsite, read from what the posting actually says. Hybrid is worth
 * its own word — it is the answer to a different question than either — and a
 * posting that says nothing gets "not stated" rather than a guess dressed up
 * as a fact.
 */
/*
 * Where the work is, split into the city and the country the posting names.
 *
 * Board locations arrive in every shape — "Bangalore, IND", "Massachusetts -
 * Boston", "San Francisco Bay Area", "Remote U.S." — so this reads what is
 * there rather than assuming a format, and says "—" when a posting simply
 * does not say. Guessing a country from a city name would be inventing a fact
 * about somebody's relocation.
 */
const COUNTRY_WORDS: [RegExp, string][] = [
  [/\b(ind|india|bangalore|bengaluru|hyderabad|pune|mumbai|delhi|noida|gurgaon|gurugram|chennai|kolkata)\b/i, 'India'],
  [/\b(usa|u\.s\.a?|united states|us|america|california|new york|texas|massachusetts|washington|seattle|austin|boston|chicago|san francisco|nyc)\b/i, 'USA'],
  [/\b(uk|united kingdom|england|london|manchester|scotland)\b/i, 'UK'],
  [/\b(canada|toronto|vancouver|montreal|ontario)\b/i, 'Canada'],
  [/\b(germany|deutschland|berlin|munich|münchen|hamburg)\b/i, 'Germany'],
  [/\b(australia|sydney|melbourne|brisbane)\b/i, 'Australia'],
  [/\b(singapore)\b/i, 'Singapore'],
  [/\b(ireland|dublin)\b/i, 'Ireland'],
  [/\b(netherlands|amsterdam|holland)\b/i, 'Netherlands'],
  [/\b(france|paris)\b/i, 'France'],
  [/\b(spain|madrid|barcelona)\b/i, 'Spain'],
  [/\b(poland|warsaw|krakow)\b/i, 'Poland'],
  [/\b(japan|tokyo)\b/i, 'Japan'],
  [/\b(uae|dubai|abu dhabi)\b/i, 'UAE'],
  [/\b(brazil|sao paulo|são paulo)\b/i, 'Brazil'],
  [/\b(mexico|mexico city)\b/i, 'Mexico'],
  [/\b(worldwide|anywhere|global)\b/i, 'Worldwide'],
];

function placeOf(job: Job): { city: string; country: string } {
  const raw = String(job.location || '').trim();
  if (!raw) return { city: '—', country: job.type && /remote/i.test(job.type) ? 'Worldwide' : '—' };

  const country = (COUNTRY_WORDS.find(([re]) => re.test(raw)) || [null, ''])[1] as string;

  /* The city is the part that is not the country marker: boards write it
     either side of the separator, so the longest human-looking fragment that
     is not a country name is the best answer available. */
  const parts = raw.split(/[,–—|/;]| - /).map((p) => p.trim()).filter(Boolean);

  /* Country names are not cities. "United States" and "IND" belong in the
     country column, and repeating them under City tells the reader nothing. */
  const COUNTRY_ONLY = /^(usa|u\.s\.a?\.?|united states( of america)?|us|india|ind|uk|united kingdom|england|canada|germany|australia|singapore|ireland|netherlands|france|spain|poland|japan|uae|brazil|mexico|europe|emea|apac|worldwide|global|anywhere)$/i;

  const cityPart = parts.find((p) =>
    p.length > 2 &&
    !/^(remote|hybrid|onsite|on-site|in-office|full-time|part-time|contract)$/i.test(p) &&
    !COUNTRY_ONLY.test(p)) || '';

  return {
    city: cityPart ? cityPart.replace(/\s+/g, ' ').slice(0, 28) : (/remote/i.test(raw) ? 'Remote' : '—'),
    country: country || '—',
  };
}

function workType(job: Job): string {
  const text = `${job.location || ''} ${job.type || ''}`.toLowerCase();
  if (/hybrid/.test(text)) return 'Hybrid';
  if (/\bremote\b|work from home|anywhere|worldwide/.test(text)) return 'Remote';
  if (/on-?site|in-?office|in person/.test(text)) return 'Onsite';
  if (/contract|freelance|hourly|fixed-price/.test(text)) return 'Contract';
  return job.location ? 'Onsite' : 'Not stated';
}

/*
 * The filters a job site has. All of them read what the posting says, on the
 * rows the hunt already returned; nothing is guessed about a posting that
 * does not say.
 */
type Filters = { where: 'all' | 'india' | 'remote'; kind: 'all' | 'internship' | 'job'; freshers: boolean; days: 7 | 30 | 183 };
const FRESHER = /\b(intern|internship|fresher|freshers|graduate|trainee|entry[- ]level|junior)\b/i;
const SENIOR = /\b(senior|sr\.?|lead|principal|staff|architect|manager|head|director|vp)\b/i;
const ageDays = (posted: string | null) => {
  const t = posted ? Date.parse(posted) : NaN;
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
};
function openToFreshers(j: Job): boolean {
  if (FRESHER.test(`${j.title} ${j.type || ''}`)) return true;
  if (SENIOR.test(j.title)) return false;
  const years = String(j.description || '').match(/(\d+)\s*\+?\s*(?:-|to)?\s*(?:\d+\s*)?(?:years|yrs)/i);
  return !years || Number(years[1]) <= 1;
}
function passes(j: Job, f: Filters): boolean {
  const days = ageDays(j.posted);
  if (days !== null && days > f.days) return false;
  if (f.where === 'india' && placeOf(j).country !== 'India') return false;
  if (f.where === 'remote' && workType(j) !== 'Remote') return false;
  const intern = /intern/i.test(`${j.title} ${j.type || ''}`);
  if (f.kind === 'internship' && !intern) return false;
  if (f.kind === 'job' && intern) return false;
  return !f.freshers || openToFreshers(j);
}
/* India first; freelance marketplaces are not job searches. */
const SEARCH_ORDER = ['Naukri', 'LinkedIn', 'Internshala', 'Unstop', 'Wellfound', 'Foundit (Monster)', 'Indeed', 'Instahyre', 'Cutshort', 'Hirist', 'Google Jobs'];

/* LinkedIn's own people search, opened in the student's account: TEN reads
   nothing from LinkedIn and stores nothing it shows. */
const people = (q: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
/* The drafted email in the student's own mail, so it goes from their address
   and the reply comes back to them. */
const gmailUrl = (to: string, subject: string, body: string) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
const mailtoUrl = (to: string, subject: string, body: string) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** The rows this browser kept before the tracker moved to the account. */
function localTracker(): TrackRow[] {
  try { return JSON.parse(localStorage.getItem(TRACKER_KEY) || '[]'); } catch { return []; }
}
const json = (method: string, body?: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

type Profile = { name: string | null; role: string; seniority: string; location: string; skills: string[]; college?: string };
type Fit = { percent: number; band: string; advice: string; confidence: number; reasons: string[] };
/* The AI's read of one opening (POST /match): checked on the server. */
type AiMatch = { score: number; reasons: string[]; missing: string[] };
/* POST /reword: only lines that passed the check against the resume. */
type Reword = {
  note: string; bullets: { before: string; after: string }[]; kept: { before: string; why: string }[];
  letter: { text: string; words: number } | null; dropped: number; questions: string[];
};
type Job = {
  source: string; title: string; company: string; location: string; type: string;
  tags: string[]; url: string; posted: string | null; matched: string[]; score: number;
  fit?: Fit; jobId?: string; stale?: boolean;
  directUrl?: string; directKind?: 'ats' | 'company' | 'via'; linkLabel?: string; fit5?: number; description?: string;
  fromCache?: boolean; seenDaysAgo?: number; postedAgo?: string;
};
type Search = { platform: string; why: string; url: string };
/* A recruiter row exists because a posting published it — sourceUrl is the
   evidence, and it is shown so anyone can check the claim. */
type Recruiter = {
  company: string; name: string; role: string; email: string; phone: string;
  sourceUrl: string; sourceTitle: string; postedAgo: string; via: string;
  alsoHiringFor: string[];
};
type SourceStat = { name: string; ok: boolean; count: number; error: string | null };
type Materials = {
  job: { title: string; company: string; url: string };
  fit: Fit;
  resume: { filename: string; text: string; ats: { before: number; after: number; passes: boolean }; gaps: string[] };
  coverLetter: { filename: string; text: string; words: number };
  coldEmail: {
    subject: string; body: string; words: number; note: string;
    followUps: { afterDays: number; subject: string; body: string }[];
  };
  hrEmail?: { subject: string; body: string; words: number; toNote: string | null };
  /* Prefilled when the posting published an address — the send step should
     not ask for something the advert already gave. */
  toEmail?: string;
  /* The posting itself, for "Reword with AI". */
  posting?: { title: string; company: string; description: string; tags: string[] };
};

export default function JobAgent() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [filters, setFilters] = useState<Filters>({ where: 'all', kind: 'all', freshers: false, days: 30 });
  const [sources, setSources] = useState<SourceStat[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  /* The resume text is kept so materials can be written for any job in the
     list without asking for the file a second time. */
  const [resumeText, setResumeText] = useState('');
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [making, setMaking] = useState('');
  const [manager, setManager] = useState('');
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [tracker, setTracker] = useState<TrackRow[]>([]);
  const [alerts, setAlerts] = useState<{ alerts: boolean; weeklyEmail: boolean; canNotify: boolean } | null>(null);
  const [ai, setAi] = useState<Record<string, AiMatch>>({});
  const [aiNote, setAiNote] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const matchRun = useRef(0);

  /* The tracker and the alert settings, from the account; this browser's old rows come across once. */
  useEffect(() => {
    (async () => {
      try {
        let data = await (await fetch(`${API}/tracker`)).json();
        const old = localTracker();
        if (data.ok && !data.rows.length && old.length) {
          await fetch(`${API}/tracker/import`, json('POST', { rows: old }));
          data = await (await fetch(`${API}/tracker`)).json();
        }
        if (data.ok) { setTracker(data.rows); if (old.length) localStorage.removeItem(TRACKER_KEY); }
      } catch { /* the tracker stays empty; nothing is lost on the server */ }
      fetch(`${API}/alerts`).then((r) => r.json()).then((a) => { if (a.ok) setAlerts(a); }).catch(() => {});
    })();
    /* A resume handed over by the resume portal is hunted straight away. */
    let handed = '';
    try { handed = localStorage.getItem(HANDOFF_RESUME) || ''; localStorage.removeItem(HANDOFF_RESUME); } catch { /* none */ }
    if (handed.trim()) hunt(undefined, handed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* One row saved to the account; the answer (with its follow-up clock) replaces the guess. */
  async function saveRow(row: Partial<TrackRow> & { url: string }) {
    setTracker((rows) => {
      const has = rows.some((r) => r.url === row.url);
      return has ? rows.map((r) => (r.url === row.url ? { ...r, ...row } : r))
        : [{ date: new Date().toISOString().slice(0, 10), company: '', role: '', fit: 0, status: 'found', notes: '', ...row } as TrackRow, ...rows];
    });
    try {
      const out = await (await fetch(`${API}/tracker`, json('PUT', row))).json();
      if (out.ok) setTracker((rows) => rows.map((r) => (r.url === row.url ? out.row : r)));
    } catch { /* kept on screen; saved next time it changes */ }
  }
  const track = (job: Job, status: TrackStatus, extra: Partial<TrackRow> = {}) => saveRow({
    company: job.company || '', role: job.title, url: job.directUrl || job.url,
    fit: job.fit5 || Math.max(1, Math.round((job.fit?.percent || 20) / 20)), status, ...extra,
  });
  const setTrackStatus = (url: string, status: TrackStatus) => saveRow({ url, status });
  const untrack = (url: string) => {
    setTracker((rows) => rows.filter((r) => r.url !== url));
    fetch(`${API}/tracker?url=${encodeURIComponent(url)}`, { method: 'DELETE' }).catch(() => {});
  };
  const saveAlerts = (next: { alerts?: boolean; weeklyEmail?: boolean }) => {
    setAlerts((a) => (a ? { ...a, ...next } : a));
    fetch(`${API}/alerts`, json('PUT', next)).catch(() => {});
  };
  /* Opens the resume portal with this job loaded: its match, and "Tailor resume". */
  const tailorInResumePortal = (j: Job) => {
    try {
      localStorage.setItem(HANDOFF_JOB, JSON.stringify({ title: j.title, company: j.company, url: j.directUrl || j.url, location: j.location, description: j.description || '', tags: j.tags || [] }));
    } catch { /* storage blocked: the resume portal opens without it */ }
    window.location.href = '/resume-portal/#agent';
  };
  const tracked = (job: Job) => tracker.some((r) => r.url === (job.directUrl || job.url));

  /*
   * The same application writer, aimed at a recruiter rather than a listing.
   * The row already carries who they are and which posting they published, so
   * the letter opens with their name and answers the advert they actually
   * wrote — which is the whole difference between an application and a blast.
   */
  async function writeForRecruiter(r: Recruiter) {
    const asJob: Job = {
      source: r.via || 'Recruiter', title: r.sourceTitle || 'the advertised role',
      company: r.company, location: '', type: '', tags: [],
      url: r.sourceUrl, directUrl: r.sourceUrl, posted: null, matched: [], score: 0,
      postedAgo: r.postedAgo,
    };
    if (r.name) setManager(r.name);
    await buildMaterials(asJob, r.email || '', r.name || '');
  }

  async function buildMaterials(job: Job, toEmail?: string, hiringManager?: string) {
    setMaking(toEmail || job.url);
    setError('');
    try {
      const body = new FormData();
      body.append('text', resumeText);
      body.append('job', JSON.stringify(job));
      if (profile) body.append('profile', JSON.stringify(profile));
      const named = hiringManager || manager;
      if (named) body.append('hiringManager', named);
      /* A recruiter who published an address gets it prefilled, so the send
         step is not asking for something the posting already said. */
      if (toEmail) body.append('to', toEmail);
      const res = await fetch(`${API}/materials`, { method: 'POST', body });
      const data = await res.json();
      if (!data.ok) throw new Said(data.error || 'Could not write the documents.');
      setMaterials({ ...data, toEmail, posting: { title: job.title, company: job.company || '', description: job.description || '', tags: job.tags || [] } });
      /* fit-and-track.md: tailoring is a tracked event. The drafted follow-ups
         and the recruiter's address go with it, for the reminders. */
      track(job, 'tailored', { followUps: data.coldEmail?.followUps || [], ...(toEmail ? { to: toEmail } : {}) });
    } catch (e) {
      setError(e instanceof Said ? e.message : 'Could not write the documents. Paste your resume text and try again.');
    } finally {
      setMaking('');
    }
  }

  /*
   * The AI's match for the top twenty, asked for after the list is on screen:
   * the hunt stays instant, and when the AI cannot answer the cards simply
   * keep the agent's own fit. A newer hunt makes an older answer stale.
   */
  async function scoreTop(list: Job[], resume: string) {
    const run = ++matchRun.current;
    setAi({}); setAiNote('');
    const top = list.slice(0, 20);
    if (!top.length || !resume.trim()) return;
    setAiBusy(true);
    try {
      const res = await fetch(`${API}/match`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeText: resume.slice(0, 8000),
          jobs: top.map((j) => ({ key: j.url, title: j.title, company: j.company, tags: j.tags, description: (j.description || '').slice(0, 1500) })),
        }),
      });
      const data = await res.json();
      if (run !== matchRun.current) return;
      if (data.ok) { setAi(data.scores || {}); setAiNote(data.note || ''); }
    } catch { /* the cards keep the agent's own fit */ } finally {
      if (run === matchRun.current) setAiBusy(false);
    }
  }

  async function hunt(file?: File, text?: string) {
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      if (file) body.append('file', file);
      if (text) body.append('text', text);
      const res = await fetch(`${API}/search`, { method: 'POST', body });
      const data = await res.json();
      if (!data.ok) throw new Said(data.error || 'The hunt could not run.');
      setCacheNote(data.cacheNote || null);
      setRecruiters(data.recruiters || []);
      /* Held for the materials step. A PDF is parsed on the server, so its
         text comes back in the response rather than existing here. */
      setResumeText(data.resumeText || text || '');
      setProfile(data.profile);
      setJobs(data.jobs);
      scoreTop(data.jobs, data.resumeText || text || '');
      setSearches(data.searches);
      setSources(data.sources);
    } catch (e) {
      setError(e instanceof Said ? e.message : 'The hunt could not run. Check that the portal server is reachable, then try again.');
    } finally {
      setBusy(false);
    }
  }

  const started = profile !== null;
  const shown = jobs.filter((j) => passes(j, filters));

  return (
    <KineticGrid>
      <div className="min-h-screen px-5 py-6 md:px-10" style={inter}>
        <div className="mx-auto max-w-[1180px]">
          {/* header */}
          <div className="mb-10 flex items-center justify-between">
            <button
              type="button"
              onClick={() => { window.location.hash = ''; }}
              className="text-[11px] font-semibold tracking-[0.18em] text-white/60 transition-colors hover:text-white"
            >
              ← JOB PORTAL
            </button>
            <span className="text-[11px] font-semibold tracking-[0.18em] text-white/60">TEN JOB AGENT</span>
          </div>

          {!started ? (
            /* ── the invitation ── */
            <div className="flex min-h-[68vh] flex-col items-center justify-center text-center">
              <span className="mb-5 rounded-full border border-white/15 px-3 py-1 text-xs font-medium tracking-wide text-white/70">
                Resume in. Real jobs out.
              </span>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                Drop your resume. It hunts.
              </h1>
              <p className="mt-4 max-w-lg text-base text-white/50">
                The agent reads what you are, then pulls live openings from job boards and aims a
                built search at LinkedIn, Upwork, Fiverr, Naukri and Google for you.
              </p>

              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="rounded-full bg-white px-8 py-4 text-[14px] font-semibold text-black transition-transform hover:scale-[1.03] disabled:opacity-50"
                >
                  {busy ? 'Hunting…' : 'Upload resume (PDF)'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) hunt(f); e.target.value = ''; }}
                />
              </div>

              <div className="mt-6 w-full max-w-xl">
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="…or paste your resume text here"
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-white/30"
                />
                {pasted.trim().length > 40 && (
                  <button
                    type="button"
                    onClick={() => hunt(undefined, pasted)}
                    disabled={busy}
                    className="mt-3 rounded-full border border-white/25 px-6 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    Hunt from this text
                  </button>
                )}
              </div>

              {error && <p className="mt-5 text-[13px] text-red-300">{error}</p>}
            </div>
          ) : (
            /* ── the findings ── */
            <div className="pb-16">
              {/* what it read */}
              <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">What the agent read</p>
                <div className="flex flex-wrap items-center gap-2">
                  {profile.name && <Chip label={profile.name} strong />}
                  <Chip label={profile.role} strong />
                  <Chip label={profile.seniority} />
                  <Chip label={profile.location} />
                  {profile.skills.map((s) => <Chip key={s} label={s} />)}
                </div>
                <button
                  type="button"
                  onClick={() => { setProfile(null); setJobs([]); setSearches([]); }}
                  className="mt-4 text-[12px] text-white/50 underline underline-offset-4 hover:text-white"
                >
                  Use a different resume
                </button>
              </div>

              <div>
                {/* live listings — the openings ARE the product. Direct
                    employer links lead; searches live in a drawer below. */}
                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-xl font-semibold text-white">
                      Openings for you <span className="text-white/40">({shown.length} of {jobs.length})</span>
                    </h2>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-emerald-300/80">
                      employer links first
                    </span>
                  </div>
                  <p className="mb-4 text-[12px] leading-relaxed text-white/45">
                    Links open the employer's own posting — their careers page or their ATS. Openings found
                    through Adzuna or Jooble open through them, straight to the advert, and say so.
                  </p>
                  {(aiBusy || aiNote || Object.keys(ai).length > 0) && (
                    <p className="-mt-2 mb-4 text-[12px] leading-relaxed text-violet-200/80">
                      {aiBusy ? 'Scoring your top 20 with AI…'
                        : aiNote || 'AI match on your top 20. "Missing" lists only skills the posting names and your resume does not show.'}
                    </p>
                  )}

                  {/* Filters: what a job site has, read from what each posting says. */}
                  <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
                    {([
                      ['where', [['all', 'Anywhere'], ['india', 'India'], ['remote', 'Remote']]],
                      ['kind', [['all', 'Jobs and internships'], ['internship', 'Internships'], ['job', 'Jobs']]],
                      ['days', [[7, 'Last 7 days'], [30, 'Last 30 days'], [183, 'Last 6 months']]],
                    ] as const).map(([key, opts]) => (
                      <div key={key} className="flex gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
                        {opts.map(([value, label]) => (
                          <button key={String(value)} type="button" aria-pressed={filters[key] === value}
                            onClick={() => setFilters((f) => ({ ...f, [key]: value }))}
                            className={['rounded-full px-3 py-1', filters[key] === value ? 'bg-white text-black' : 'text-white/65 hover:text-white'].join(' ')}>
                            {label}
                          </button>
                        ))}
                      </div>
                    ))}
                    <button type="button" aria-pressed={filters.freshers}
                      onClick={() => setFilters((f) => ({ ...f, freshers: !f.freshers }))}
                      className={['rounded-full border px-3 py-1.5', filters.freshers ? 'border-white bg-white text-black' : 'border-white/10 text-white/65 hover:text-white'].join(' ')}>
                      Open to freshers
                    </button>
                  </div>

                  {cacheNote && (
                    <p className="mb-3 rounded-xl border border-violet-400/25 bg-violet-400/[0.07] p-3 text-[12.5px] leading-relaxed text-violet-100/85">
                      {cacheNote}
                    </p>
                  )}
                  {/*
                    The hunt table, in the job-hunt skill's own columns:
                    # | Role | Company | Where | Fit | Opening URL. The URL
                    cell is the employer's own posting with the posting's age
                    beside it, so a student can scan the whole hunt in one
                    pass instead of reading cards.
                  */}
                  {shown.length > 0 && (
                    <div className="mb-6 overflow-x-auto rounded-2xl border border-white/10">
                      <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
                        <thead>
                          <tr className="bg-white/[0.05] text-left text-white/60">
                            <th className="px-3 py-2 font-semibold">Job</th>
                            <th className="px-3 py-2 font-semibold">Position</th>
                            <th className="px-3 py-2 font-semibold">Type</th>
                            <th className="px-3 py-2 font-semibold">City</th>
                            <th className="px-3 py-2 font-semibold">Country</th>
                            <th className="px-3 py-2 font-semibold">Link</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((j, i) => (
                            <tr key={'row' + j.url + i} className="border-t border-white/[0.07] align-top hover:bg-white/[0.03]">
                              {/* Job — who is hiring. */}
                              <td className="px-3 py-2 font-semibold text-white">{j.company || '—'}</td>
                              {/* Position — the role itself. */}
                              <td className="px-3 py-2 text-white/80">{j.title}</td>
                              {/* Type — remote or onsite, decided from what the
                                  posting says rather than guessed. */}
                              <td className="px-3 py-2 whitespace-nowrap text-white/65">{workType(j)}</td>
                              {/* Where the work is — read from the posting,
                                  never guessed when it does not say. */}
                              <td className="px-3 py-2 text-white/65">{placeOf(j).city}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-white/65">{placeOf(j).country}</td>
                              <td className="px-3 py-2">
                                <a href={j.directUrl || j.url} target="_blank" rel="noopener noreferrer"
                                   className="break-all text-emerald-300 hover:underline">
                                  {j.directUrl || j.url}
                                </a>
                                {j.postedAgo && (
                                  <span className="ml-1 whitespace-nowrap text-white/40">({j.postedAgo})</span>
                                )}
                                {j.directKind === 'via' && (
                                  <span className="ml-1 whitespace-nowrap text-white/40">via {j.source}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    {jobs.length === 0 && (
                      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/55">
                        No opening this pass could be traced to an employer's own posting, so nothing
                        is listed — a link to a search page would not be a job. The company boards
                        refresh through the day; try again shortly.
                      </p>
                    )}
                    {jobs.length > 0 && shown.length === 0 && (
                      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/55">
                        None of the {jobs.length} openings match these filters. Widen one — "Last 6 months" or
                        "Anywhere" — to see them.
                      </p>
                    )}
                    {shown.map((j, i) => (
                      <div
                        key={j.url + i}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/[0.07]"
                      >
                        {/* The link IS the row. It opens the employer's own
                            posting, and its age follows in brackets — no
                            board name, no search page, nothing between the
                            click and the job. */}
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[14.5px] font-semibold leading-snug text-white">
                            <a href={j.directUrl || j.url} target="_blank" rel="noopener noreferrer"
                               className="text-emerald-300 hover:underline">
                              {j.title}
                            </a>
                            {j.postedAgo && (
                              <span className="font-normal text-white/45">{' '}({j.postedAgo})</span>
                            )}
                            {j.directKind === 'via' && (
                              <span className="font-normal text-white/45">{' '}· via {j.source}</span>
                            )}
                          </p>
                          {ai[j.url] ? <div className="shrink-0"><AiBadge m={ai[j.url]} fit={j.fit} /></div>
                            : j.fit && <div className="shrink-0"><FitBadge fit={j.fit} /></div>}
                        </div>
                        <p className="mt-1 text-[12.5px] text-white/55">
                          {[j.company, j.location, j.type].filter(Boolean).join(' · ')}
                        </p>
                        <p className="mt-1 break-all text-[11px] text-white/30">{j.directUrl || j.url}</p>

                        {/* Why it scored what it scored: the AI's reasons when it
                            answered, otherwise the agent's own arithmetic. */}
                        {ai[j.url] ? (
                          <>
                            {ai[j.url].reasons.map((r) => (
                              <p key={r} className="mt-2 text-[11.5px] leading-relaxed text-white/60">{r}</p>
                            ))}
                            {ai[j.url].missing.length > 0 && (
                              <p className="mt-1 text-[11.5px] text-amber-200/85">missing: {ai[j.url].missing.join(', ')}</p>
                            )}
                          </>
                        ) : j.fit && j.fit.reasons.length > 0 && (
                          <p className="mt-2 text-[11.5px] leading-relaxed text-white/50">{j.fit.reasons[0]}</p>
                        )}
                        {j.matched?.length > 0 && (
                          <p className="mt-1 text-[11.5px] text-sky-300/85">matches your {j.matched.join(', ')}</p>
                        )}
                        {j.stale && (
                          <p className="mt-1 text-[11px] text-amber-300/80">
                            confirm it is still open before investing an evening
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => buildMaterials(j)}
                            disabled={making === j.url}
                            className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-bold text-[#0b1020] disabled:opacity-50"
                          >
                            {making === j.url ? 'Writing…' : 'Write my application'}
                          </button>
                          <a href={j.directUrl || j.url} target="_blank" rel="noopener noreferrer"
                             className="rounded-lg bg-emerald-400/90 px-3 py-1.5 text-[12px] font-bold text-[#06210f] hover:bg-emerald-300">
                            Open the job
                          </a>
                          <button type="button" onClick={() => tailorInResumePortal(j)}
                            className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] text-white/85 hover:border-white/50">
                            Tailor my resume ↗
                          </button>
                          <button
                            type="button"
                            onClick={() => track(j, 'found')}
                            disabled={tracked(j)}
                            className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-[12px] text-violet-200/90 hover:border-violet-300/60 disabled:opacity-40"
                          >
                            {tracked(j) ? 'Tracked ✓' : 'Save to tracker'}
                          </button>
                          {j.company && (
                            <a href={people(`${j.company} recruiter`)} target="_blank" rel="noopener noreferrer"
                               className="rounded-lg border border-sky-300/25 px-3 py-1.5 text-[12px] text-sky-200/90 hover:border-sky-300/60">
                              Recruiters at {j.company} ↗
                            </a>
                          )}
                          {j.company && profile?.college && (
                            <a href={people(`${j.company} ${profile.college}`)} target="_blank" rel="noopener noreferrer"
                               className="rounded-lg border border-sky-300/25 px-3 py-1.5 text-[12px] text-sky-200/90 hover:border-sky-300/60">
                              {profile.college} alumni there ↗
                            </a>
                          )}
                          {j.jobId && <span className="text-[10.5px] text-white/30">{j.jobId}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/*
                  Recruiters — the people who published a way to reach them in
                  their own advert. Every row carries the posting it came from,
                  because that posting is the reason the row is allowed to
                  exist. Nothing here is guessed and nothing is scraped from a
                  profile: an address appears only where a hiring team wrote
                  "send your CV here" in public.
                */}
                <div className="mt-8">
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-xl font-semibold text-white">
                      Recruiters <span className="text-white/40">({recruiters.length})</span>
                    </h2>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-sky-300/80">
                      published in the posting
                    </span>
                  </div>
                  <p className="mb-4 text-[12px] leading-relaxed text-white/45">
                    Contacts the hiring team put in their own advert — the "send your CV to…" line.
                    Every row links to the posting it came from, and an email is left out when its
                    domain cannot receive mail. Nothing is guessed and nothing is taken from anyone's profile, so
                    what you see is what a company asked you to use. To find the people hiring at a
                    company, use "Recruiters at …" on its opening: it searches LinkedIn as you.
                  </p>

                  {recruiters.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/55">
                      None of this hunt's postings published a direct contact — most large employers
                      route everything through their apply button. Use the green link on a row and
                      the agent's cold email, or "Recruiters at …" to find the hiring team on LinkedIn;
                      when a posting does name a recruiter, they appear here.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border border-white/10">
                      <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
                        <thead>
                          <tr className="bg-white/[0.05] text-left text-white/60">
                            <th className="px-3 py-2 font-semibold">Company</th>
                            <th className="px-3 py-2 font-semibold">Contact</th>
                            <th className="px-3 py-2 font-semibold">Email</th>
                            <th className="px-3 py-2 font-semibold">Phone</th>
                            <th className="px-3 py-2 font-semibold">From this posting</th>
                            <th className="px-3 py-2 font-semibold">Application</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recruiters.map((r) => (
                            <tr key={(r.email || r.phone) + r.sourceUrl}
                                className="border-t border-white/[0.07] align-top hover:bg-white/[0.03]">
                              <td className="px-3 py-2 font-semibold text-white">{r.company || '—'}</td>
                              <td className="px-3 py-2 text-white/75">
                                {r.name || <span className="text-white/35">not named</span>}
                                {r.role && <span className="block text-[11px] text-white/40">{r.role}</span>}
                              </td>
                              <td className="px-3 py-2">
                                {r.email ? (
                                  <a href={`mailto:${r.email}`} className="break-all text-emerald-300 hover:underline">
                                    {r.email}
                                  </a>
                                ) : <span className="text-white/30">—</span>}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {r.phone ? (
                                  <a href={`tel:${r.phone.replace(/\s/g, '')}`} className="text-emerald-300 hover:underline">
                                    {r.phone}
                                  </a>
                                ) : <span className="text-white/30">—</span>}
                              </td>
                              <td className="px-3 py-2">
                                <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
                                   className="text-sky-300 hover:underline">
                                  {r.sourceTitle ? r.sourceTitle.slice(0, 44) : 'the posting'}
                                </a>
                                {r.postedAgo && <span className="text-white/40"> ({r.postedAgo})</span>}
                                {r.alsoHiringFor.length > 0 && (
                                  <span className="block text-[11px] text-white/40">
                                    also hiring: {r.alsoHiringFor.slice(0, 2).join(', ')}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {/* The same writer the job rows use, aimed at
                                    this recruiter: their name in the greeting,
                                    their posting in the subject. */}
                                <button
                                  type="button"
                                  onClick={() => writeForRecruiter(r)}
                                  disabled={making === (r.email || r.phone)}
                                  className="whitespace-nowrap rounded-lg bg-white px-3 py-1.5 text-[12px] font-bold text-[#0b1020] disabled:opacity-50"
                                >
                                  {making === (r.email || r.phone) ? 'Writing…' : 'Write my application'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-3 text-[11.5px] leading-relaxed text-white/35">
                    Write once, to one person, about the role they posted. A recruiter who published
                    an address expects applications — they do not expect the same letter sent to
                    forty of them.
                  </p>
                </div>

                {/* Job alerts: the phone by default, email only if asked for. */}
                {alerts && alerts.canNotify && (
                  <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12.5px] text-white/70">
                    <span className="font-semibold text-white">Job alerts</span>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={alerts.alerts} onChange={(e) => saveAlerts({ alerts: e.target.checked })} />
                      Tell my phone when new jobs fit my resume
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={alerts.weeklyEmail} onChange={(e) => saveAlerts({ weeklyEmail: e.target.checked })} />
                      Also email me a weekly digest
                    </label>
                  </div>
                )}

                {/* The application tracker — fit-and-track.md as a panel. */}
                {tracker.length > 0 && (
                  <div className="mt-8">
                    <div className="mb-3 flex items-baseline justify-between">
                      <h2 className="text-xl font-semibold text-white">
                        Application tracker <span className="text-white/40">({tracker.length})</span>
                      </h2>
                      <span className="text-[11px] uppercase tracking-[0.14em] text-violet-300/80">saved to your account</span>
                    </div>
                    <div className="space-y-2">
                      {tracker.map((r) => (
                        <div key={r.url} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <a href={r.url} target="_blank" rel="noopener noreferrer"
                               className="block truncate text-[13px] font-semibold text-white hover:underline">
                              {r.role}{r.company ? ` — ${r.company}` : ''}
                            </a>
                            <p className="text-[11px] text-white/40">{r.date} · fit {r.fit}/5</p>
                            {/* A drafted follow-up whose day has come: send it from your own mail. */}
                            {dueFollowUps(r).map((f) => (
                              <div key={f.afterDays} className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                                <span className="text-amber-200/90">Day {f.afterDays} follow-up is due.</span>
                                {r.to && (
                                  <a href={gmailUrl(r.to, f.subject, f.body)} target="_blank" rel="noopener noreferrer"
                                    className="rounded-md border border-white/15 px-2 py-0.5 text-white/80 hover:border-white/40">Open in Gmail</a>
                                )}
                                <button type="button" onClick={() => navigator.clipboard?.writeText(f.body)}
                                  className="rounded-md border border-white/15 px-2 py-0.5 text-white/80 hover:border-white/40">Copy it</button>
                                <button type="button" onClick={() => saveRow({ url: r.url, followUpsSent: [f.afterDays] })}
                                  className="rounded-md border border-emerald-300/30 px-2 py-0.5 text-emerald-200/90 hover:border-emerald-200/60">Mark sent</button>
                              </div>
                            ))}
                          </div>
                          <select
                            value={r.status}
                            onChange={(e) => setTrackStatus(r.url, e.target.value as TrackStatus)}
                            className="rounded-lg border border-white/15 bg-[#0b1020] px-2 py-1 text-[12px] text-white/80"
                          >
                            {TRACK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button type="button" onClick={() => untrack(r.url)}
                                  className="text-[12px] text-white/35 hover:text-rose-300" aria-label="Remove from tracker">
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/*
                  Searches on the sites that need a login, kept apart from the
                  openings. They were once mixed into the list, where a click
                  on "Naukri" landed on a search page instead of a job; here
                  they are labelled as what they are.
                */}
                {searches.some((x) => SEARCH_ORDER.includes(x.platform)) && (
                  <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="mb-1 text-[13px] font-semibold text-white">Search these sites yourself</p>
                    <p className="mb-3 text-[12px] leading-relaxed text-white/45">
                      Each opens that site's own search with your role and city, signed in as you. These are
                      searches, not openings, so they are kept apart from the list above.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {SEARCH_ORDER.map((name) => searches.find((x) => x.platform === name)).filter(Boolean).map((x) => (
                        <a key={x!.platform} href={x!.url} target="_blank" rel="noopener noreferrer" title={x!.why}
                          className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-white/80 hover:border-white/40 hover:text-white">
                          {x!.platform.replace(' (Monster)', '')} ↗
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {materials && (
        <MaterialsPanel
          data={materials}
          resume={resumeText}
          onClose={() => setMaterials(null)}
          onEmailed={() => {
            const j = jobs.find((x) => x.url === materials.job.url);
            if (j) track(j, 'emailed');
          }}
        />
      )}
    </KineticGrid>
  );
}

/** The fitness verdict, coloured by band and honest about thin evidence. */
function AiBadge({ m, fit }: { m: AiMatch; fit?: Fit }) {
  const tone = m.score >= 85 ? 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30'
    : m.score >= 60 ? 'bg-sky-400/15 text-sky-300 border-sky-400/30'
      : 'bg-amber-400/12 text-amber-300/90 border-amber-400/25';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone}`}
      title={`The AI's read of your resume against this posting.${fit && fit.band !== 'unknown' ? ` The agent's own fit: ${fit.percent}%.` : ''}`}>
      AI match {m.score}
    </span>
  );
}

function FitBadge({ fit }: { fit: Fit }) {
  const tone =
    fit.band === 'strong' ? 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30'
      : fit.band === 'moderate' ? 'bg-sky-400/15 text-sky-300 border-sky-400/30'
        : fit.band === 'unknown' ? 'bg-white/10 text-white/50 border-white/20'
          : 'bg-amber-400/12 text-amber-300/90 border-amber-400/25';
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone}`}
      title={`${fit.advice} (confidence ${fit.confidence}%)`}
    >
      {fit.band === 'unknown' ? '— fit' : `${fit.percent}% fit`}
    </span>
  );
}

/**
 * The three documents, side by side with what they are worth. The gaps list
 * is shown as prominently as the resume itself: it is the part that decides
 * whether the application is worth sending.
 */
function MaterialsPanel({ data, resume, onClose, onEmailed }: { data: Materials; resume: string; onClose: () => void; onEmailed?: () => void }) {
  const copy = (text: string) => navigator.clipboard?.writeText(text);

  /* The documents as shown: the agent's own, until the AI's checked lines replace them. */
  const [resumeDoc, setResumeDoc] = useState(data.resume.text);
  const [letterDoc, setLetterDoc] = useState({ text: data.coverLetter.text, words: data.coverLetter.words });
  const [reword, setReword] = useState<Reword | null>(null);
  const [rewording, setRewording] = useState(false);

  async function rewordWithAi() {
    setRewording(true);
    try {
      const res = await fetch(`${API}/reword`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: resume.slice(0, 8000), job: data.posting || data.job }),
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error);
      const bullets: Reword['bullets'] = out.bullets || [];
      setResumeDoc((doc) => bullets.reduce((d, b) => d.split(`• ${b.before}`).join(`• ${b.after}`), doc));
      if (out.letter) setLetterDoc(out.letter);
      setReword(out);
    } catch {
      setReword({ note: 'Could not reach the AI just now. Your documents are unchanged.', bullets: [], kept: [], letter: null, dropped: 0, questions: [] });
    } finally {
      setRewording(false);
    }
  }

  /* Sending is two deliberate steps: prepare puts the letter in Instantly as a
     draft, send is the one that reaches a person. They are never combined. */
  const [to, setTo] = useState(data.toEmail || '');
  const [outreach, setOutreach] = useState<{ campaignId: string; to: string } | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'preparing' | 'ready' | 'sending' | 'sent'>('idle');
  const [sendError, setSendError] = useState('');

  async function prepare() {
    setSendState('preparing');
    setSendError('');
    try {
      const res = await fetch('/api/v2/job-outreach/prepare', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject: data.coldEmail.subject,
          body: data.coldEmail.body,
          company: data.job.company,
          jobTitle: data.job.title,
          jobUrl: data.job.url
        })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setOutreach({ campaignId: json.campaignId, to: json.to });
      setSendState('ready');
      onEmailed?.(); /* the tracker's "emailed" event, per the skill */
    } catch (e: any) {
      setSendError(e.message || 'Could not prepare the email.');
      setSendState('idle');
    }
  }

  async function send() {
    if (!outreach) return;
    setSendState('sending');
    try {
      const res = await fetch('/api/v2/job-outreach/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: outreach.campaignId, confirm: true })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setSendState('sent');
    } catch (e: any) {
      setSendError(e.message || 'Could not send.');
      setSendState('ready');
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/80 p-4 backdrop-blur-sm md:p-8" style={inter}>
      <div className="mx-auto max-w-[900px] rounded-3xl border border-white/12 bg-[#0b1020] p-6 md:p-8">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-sky-300/80">Your application</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">{data.job.title}</h2>
            <p className="text-[13px] text-white/50">{data.job.company}</p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/70">
            Close
          </button>
        </div>

        {/* Cold email first: it is the thing that actually gets a reply. */}
        <Doc
          title="Cold email to the hiring manager"
          meta={`${data.coldEmail.words} words · subject: ${data.coldEmail.subject}`}
          text={data.coldEmail.body}
          onCopy={copy}
        />
        <p className="-mt-2 mb-4 text-[11.5px] leading-relaxed text-white/40">{data.coldEmail.note}</p>

        {/* Sending. Two steps, because the second one cannot be taken back. */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-2 text-[12px] font-semibold text-white/80">Send it</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="hiring@company.com"
              disabled={sendState === 'sent'}
              className="min-w-[220px] flex-1 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
            />
            {sendState !== 'ready' && sendState !== 'sending' && sendState !== 'sent' && (
              <button
                type="button"
                onClick={prepare}
                disabled={!to || sendState === 'preparing'}
                className="rounded-lg bg-white px-3.5 py-2 text-[12.5px] font-bold text-[#0b1020] disabled:opacity-40"
              >
                {sendState === 'preparing' ? 'Preparing…' : 'Prepare'}
              </button>
            )}
            {(sendState === 'ready' || sendState === 'sending') && (
              <button
                type="button"
                onClick={send}
                disabled={sendState === 'sending'}
                className="rounded-lg bg-emerald-400 px-3.5 py-2 text-[12.5px] font-bold text-[#06210f] disabled:opacity-50"
              >
                {sendState === 'sending' ? 'Sending…' : `Send to ${outreach?.to}`}
              </button>
            )}
          </div>

          {/* From the student's own address: the reply comes back to them, and
              nothing is sent until they press send there. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a href={gmailUrl(to, data.coldEmail.subject, data.coldEmail.body)} target="_blank" rel="noopener noreferrer"
               className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold text-white/85 hover:border-white/50">
              Open in Gmail
            </a>
            <a href={mailtoUrl(to, data.coldEmail.subject, data.coldEmail.body)}
               className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold text-white/85 hover:border-white/50">
              Open in my mail app
            </a>
            <span className="text-[11px] text-white/40">Sends from your own address, so the reply comes to you. Attach your resume there.</span>
          </div>

          {sendState === 'ready' && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-amber-200/85">
              Drafted in Instantly — nothing has been delivered yet. Pressing send emails a real
              person and cannot be undone.
            </p>
          )}
          {sendState === 'sent' && (
            <p className="mt-2 text-[11.5px] font-semibold text-emerald-300">
              Sent. Replies land in the mailbox connected to Instantly.
            </p>
          )}
          {sendError && <p className="mt-2 text-[11.5px] text-rose-300/90">{sendError}</p>}
          {!sendError && sendState === 'idle' && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
              Applies to one company at a time, from the mailbox connected to Instantly.
            </p>
          )}
        </div>

        <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-2 text-[12px] font-semibold text-white/80">Follow-ups if nobody replies</p>
          {data.coldEmail.followUps.map((f) => (
            <div key={f.afterDays} className="mb-2 last:mb-0">
              <p className="text-[11.5px] text-sky-300/80">day {f.afterDays}</p>
              <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-white/60">{f.body}</pre>
            </div>
          ))}
        </div>

        {data.hrEmail && (
          <>
            <Doc
              title="Formal application email to HR"
              meta={`${data.hrEmail.words} words · subject: ${data.hrEmail.subject}`}
              text={data.hrEmail.body}
              onCopy={copy}
            />
            {data.hrEmail.toNote && (
              <p className="-mt-2 mb-5 text-[11.5px] leading-relaxed text-white/40">{data.hrEmail.toNote}</p>
            )}
          </>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={rewordWithAi} disabled={rewording || !!(reword && !reword.note)}
            className="rounded-lg border border-violet-300/40 bg-violet-400/10 px-3 py-1.5 text-[12px] font-semibold text-violet-100 hover:border-violet-200/70 disabled:opacity-50">
            {rewording ? 'Rewording…' : reword && !reword.note ? 'Reworded with AI ✓' : 'Reword with AI'}
          </button>
          <span className="text-[11px] leading-relaxed text-white/40">
            Your bullets and letter, said for this job. Every line is checked against your resume; nothing new is added.
          </span>
        </div>
        {reword && (
          <div className="mb-5 rounded-2xl border border-violet-300/25 bg-violet-400/[0.06] p-4 text-[12px] leading-relaxed text-white/70">
            {reword.note ? <p>{reword.note}</p> : (
              <>
                <p>
                  {reword.bullets.length
                    ? `The AI reworded ${reword.bullets.length} bullet${reword.bullets.length === 1 ? '' : 's'} for this job, each checked against your resume.`
                    : 'The AI found nothing to reword without adding something new, so your bullets are as you wrote them.'}
                  {' '}{reword.letter
                    ? `The cover letter is the AI's${reword.dropped ? `, with ${reword.dropped} sentence${reword.dropped === 1 ? '' : 's'} left out for saying something your resume does not` : ''}.`
                    : "The cover letter is still the agent's own: the AI's did not pass the check."}
                </p>
                {reword.kept.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-white/55">
                    {reword.kept.map((k) => <li key={k.before}>Kept as you wrote it: "{k.before}" ({k.why}).</li>)}
                  </ul>
                )}
                {reword.questions.length > 0 && (
                  <div className="mt-3">
                    <p className="font-semibold text-violet-100">Answer these to make it stronger, then add the numbers yourself if they are true:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-white/60">
                      {reword.questions.map((q) => <li key={q}>{q}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <Doc
          title="Tailored resume"
          meta={`keyword match ${data.resume.ats.before}% → ${data.resume.ats.after}%${data.resume.ats.passes ? ' · passes' : ''}${reword && reword.bullets.length ? ' · before rewording' : ''}`}
          text={resumeDoc}
          onCopy={copy}
        />

        {data.resume.gaps.length > 0 && (
          <div className="mb-5 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
            <p className="text-[12px] font-semibold text-amber-200">
              Asked for, but not in your resume
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-white/55">
              These were not added for you. Add them only if you have actually done them —
              a resume that claims what you cannot defend fails at the interview instead of the filter.
            </p>
            <p className="mt-2 text-[12px] text-amber-100/80">{data.resume.gaps.join(' · ')}</p>
          </div>
        )}

        <Doc
          title="Cover letter"
          meta={`${letterDoc.words} words`}
          text={letterDoc.text}
          onCopy={copy}
        />
      </div>
    </div>
  );
}

function Doc({ title, meta, text, onCopy }: { title: string; meta: string; text: string; onCopy: (t: string) => void }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/40">{meta}</span>
          <button type="button" onClick={() => onCopy(text)}
                  className="rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-bold text-[#0b1020]">
            Copy
          </button>
        </div>
      </div>
      <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[12.5px] leading-relaxed text-white/75">
        {text}
      </pre>
    </div>
  );
}

function Chip({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <span
      className={
        strong
          ? 'rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black'
          : 'rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/70'
      }
    >
      {label}
    </span>
  );
}
