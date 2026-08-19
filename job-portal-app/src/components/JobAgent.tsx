import { useRef, useState } from 'react';
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
const inter = { fontFamily: "'Inter', sans-serif" };

/*
 * The application tracker, per the job-hunt skill's fit-and-track.md: one row
 * per opening — date, company, role, url, fit, status, notes — statuses
 * found | emailed | tailored | applied | closed, and never a duplicate URL.
 * Lives in localStorage: applications are personal to this browser's owner.
 */
type TrackStatus = 'found' | 'emailed' | 'tailored' | 'applied' | 'closed';
type TrackRow = {
  date: string; company: string; role: string; url: string;
  fit: number; status: TrackStatus; notes: string;
};
const TRACKER_KEY = 'ten_job_tracker';
const TRACK_STATUSES: TrackStatus[] = ['found', 'emailed', 'tailored', 'applied', 'closed'];

/**
 * Remote or onsite, read from what the posting actually says. Hybrid is worth
 * its own word — it is the answer to a different question than either — and a
 * posting that says nothing gets "not stated" rather than a guess dressed up
 * as a fact.
 */
function workType(job: Job): string {
  const text = `${job.location || ''} ${job.type || ''}`.toLowerCase();
  if (/hybrid/.test(text)) return 'Hybrid';
  if (/\bremote\b|work from home|anywhere|worldwide/.test(text)) return 'Remote';
  if (/on-?site|in-?office|in person/.test(text)) return 'Onsite';
  if (/contract|freelance|hourly|fixed-price/.test(text)) return 'Contract';
  return job.location ? 'Onsite' : 'Not stated';
}

function loadTracker(): TrackRow[] {
  try { return JSON.parse(localStorage.getItem(TRACKER_KEY) || '[]'); } catch { return []; }
}
function saveTracker(rows: TrackRow[]) {
  try { localStorage.setItem(TRACKER_KEY, JSON.stringify(rows)); } catch { /* full */ }
}
/** Insert or update by URL — the spec's no-duplicates rule. */
function upsertTrack(rows: TrackRow[], row: Omit<TrackRow, 'date'>): TrackRow[] {
  const existing = rows.find((r) => r.url === row.url);
  if (existing) {
    return rows.map((r) => r.url === row.url ? { ...r, status: row.status, notes: row.notes || r.notes } : r);
  }
  return [{ ...row, date: new Date().toISOString().slice(0, 10) }, ...rows].slice(0, 100);
}

type Profile = { name: string | null; role: string; seniority: string; location: string; skills: string[] };
type Fit = { percent: number; band: string; advice: string; confidence: number; reasons: string[] };
type Job = {
  source: string; title: string; company: string; location: string; type: string;
  tags: string[]; url: string; posted: string | null; matched: string[]; score: number;
  fit?: Fit; jobId?: string; stale?: boolean;
  directUrl?: string; directKind?: 'ats' | 'company'; linkLabel?: string; fit5?: number;
  fromCache?: boolean; seenDaysAgo?: number; postedAgo?: string;
};
type Search = { platform: string; why: string; url: string };
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
};

export default function JobAgent() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
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
  const [tracker, setTracker] = useState<TrackRow[]>(loadTracker);

  const track = (job: Job, status: TrackStatus) => {
    const next = upsertTrack(tracker, {
      company: job.company || '', role: job.title, url: job.directUrl || job.url,
      fit: job.fit5 || Math.max(1, Math.round((job.fit?.percent || 20) / 20)),
      status, notes: '',
    });
    setTracker(next); saveTracker(next);
  };
  const setTrackStatus = (url: string, status: TrackStatus) => {
    const next = tracker.map((r) => r.url === url ? { ...r, status } : r);
    setTracker(next); saveTracker(next);
  };
  const untrack = (url: string) => {
    const next = tracker.filter((r) => r.url !== url);
    setTracker(next); saveTracker(next);
  };
  const tracked = (job: Job) => tracker.some((r) => r.url === (job.directUrl || job.url));

  async function buildMaterials(job: Job) {
    setMaking(job.url);
    setError('');
    try {
      const body = new FormData();
      body.append('text', resumeText);
      body.append('job', JSON.stringify(job));
      if (profile) body.append('profile', JSON.stringify(profile));
      if (manager) body.append('hiringManager', manager);
      const res = await fetch(`${API}/materials`, { method: 'POST', body });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setMaterials(data);
      track(job, 'tailored'); /* fit-and-track.md: tailoring is a tracked event */
    } catch (e) {
      setError('Could not write the documents. Paste your resume text and try again.');
    } finally {
      setMaking('');
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
      if (!data.ok) throw new Error(data.error || 'search failed');
      setCacheNote(data.cacheNote || null);
      /* Held for the materials step. A PDF is parsed on the server, so its
         text comes back in the response rather than existing here. */
      setResumeText(data.resumeText || text || '');
      setProfile(data.profile);
      setJobs(data.jobs);
      setSearches(data.searches);
      setSources(data.sources);
    } catch (e) {
      setError('The hunt could not run. Check that the portal server is reachable, then try again.');
    } finally {
      setBusy(false);
    }
  }

  const started = profile !== null;

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
                      Openings for you <span className="text-white/40">({jobs.length})</span>
                    </h2>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-emerald-300/80">
                      direct company links only
                    </span>
                  </div>
                  <p className="mb-4 text-[12px] leading-relaxed text-white/45">
                    Every link opens the employer's own posting — their careers page or their ATS.
                    Nothing here routes through a board or a search page.
                  </p>

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
                  {jobs.length > 0 && (
                    <div className="mb-6 overflow-x-auto rounded-2xl border border-white/10">
                      <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
                        <thead>
                          <tr className="bg-white/[0.05] text-left text-white/60">
                            <th className="px-3 py-2 font-semibold">Job</th>
                            <th className="px-3 py-2 font-semibold">Position</th>
                            <th className="px-3 py-2 font-semibold">Type</th>
                            <th className="px-3 py-2 font-semibold">Link</th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobs.map((j, i) => (
                            <tr key={'row' + j.url + i} className="border-t border-white/[0.07] align-top hover:bg-white/[0.03]">
                              {/* Job — who is hiring. */}
                              <td className="px-3 py-2 font-semibold text-white">{j.company || '—'}</td>
                              {/* Position — the role itself. */}
                              <td className="px-3 py-2 text-white/80">{j.title}</td>
                              {/* Type — remote or onsite, decided from what the
                                  posting says rather than guessed. */}
                              <td className="px-3 py-2 whitespace-nowrap text-white/65">{workType(j)}</td>
                              <td className="px-3 py-2">
                                <a href={j.directUrl || j.url} target="_blank" rel="noopener noreferrer"
                                   className="break-all text-emerald-300 hover:underline">
                                  {j.directUrl || j.url}
                                </a>
                                {j.postedAgo && (
                                  <span className="ml-1 whitespace-nowrap text-white/40">({j.postedAgo})</span>
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
                    {jobs.map((j, i) => (
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
                          </p>
                          {j.fit && <div className="shrink-0"><FitBadge fit={j.fit} /></div>}
                        </div>
                        <p className="mt-1 text-[12.5px] text-white/55">
                          {[j.company, j.location, j.type].filter(Boolean).join(' · ')}
                        </p>
                        <p className="mt-1 break-all text-[11px] text-white/30">{j.directUrl || j.url}</p>

                        {/* Why it scored what it scored, in the agent's own arithmetic. */}
                        {j.fit?.reasons?.length > 0 && (
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
                          <button
                            type="button"
                            onClick={() => track(j, 'found')}
                            disabled={tracked(j)}
                            className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-[12px] text-violet-200/90 hover:border-violet-300/60 disabled:opacity-40"
                          >
                            {tracked(j) ? 'Tracked ✓' : 'Save to tracker'}
                          </button>
                          {j.jobId && <span className="text-[10.5px] text-white/30">{j.jobId}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* The application tracker — fit-and-track.md as a panel. */}
                {tracker.length > 0 && (
                  <div className="mt-8">
                    <div className="mb-3 flex items-baseline justify-between">
                      <h2 className="text-xl font-semibold text-white">
                        Application tracker <span className="text-white/40">({tracker.length})</span>
                      </h2>
                      <span className="text-[11px] uppercase tracking-[0.14em] text-violet-300/80">saved in this browser</span>
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
                  The platform search cards are gone. They listed board names —
                  LinkedIn, Naukri, Glassdoor — and every click landed on a
                  search page rather than a job, which is the opposite of what
                  this portal promises. If a listing cannot be resolved to the
                  employer's own posting it is not shown at all.
                */}
              </div>
            </div>
          )}
        </div>
      </div>

      {materials && (
        <MaterialsPanel
          data={materials}
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
function MaterialsPanel({ data, onClose, onEmailed }: { data: Materials; onClose: () => void; onEmailed?: () => void }) {
  const copy = (text: string) => navigator.clipboard?.writeText(text);

  /* Sending is two deliberate steps: prepare puts the letter in Instantly as a
     draft, send is the one that reaches a person. They are never combined. */
  const [to, setTo] = useState('');
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

        <Doc
          title="Tailored resume"
          meta={`keyword match ${data.resume.ats.before}% → ${data.resume.ats.after}%${data.resume.ats.passes ? ' · passes' : ''}`}
          text={data.resume.text}
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
          meta={`${data.coverLetter.words} words`}
          text={data.coverLetter.text}
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
