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

type Profile = { name: string | null; role: string; seniority: string; location: string; skills: string[] };
type Fit = { percent: number; band: string; advice: string; confidence: number; reasons: string[] };
type Job = {
  source: string; title: string; company: string; location: string; type: string;
  tags: string[]; url: string; posted: string | null; matched: string[]; score: number;
  fit?: Fit; jobId?: string; stale?: boolean;
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

              <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
                {/* live listings */}
                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-xl font-semibold text-white">
                      Live openings <span className="text-white/40">({jobs.length})</span>
                    </h2>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-emerald-300/80">fetched now</span>
                  </div>
                  <p className="mb-4 text-[12px] leading-relaxed text-white/45">
                    Real postings from boards that publish a public API, ranked against your resume.
                    {sources.length > 0 && ' Sources: ' + sources.map((s) => `${s.name} ${s.ok ? s.count : '×'}`).join(' · ')}
                  </p>

                  <div className="space-y-2.5">
                    {jobs.length === 0 && (
                      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-[13px] text-white/55">
                        No live matches right now — the aimed searches beside this are where your role
                        mostly lives. Try again later; these boards refresh hourly.
                      </p>
                    )}
                    {jobs.map((j, i) => (
                      <div
                        key={j.url + i}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/[0.07]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <a href={j.url} target="_blank" rel="noopener noreferrer"
                             className="text-[14.5px] font-semibold leading-snug text-white hover:underline">
                            {j.title}
                          </a>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {j.fit && <FitBadge fit={j.fit} />}
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-wide text-white/60">{j.source}</span>
                          </div>
                        </div>
                        <p className="mt-1 text-[12.5px] text-white/55">
                          {[j.company, j.location, j.type].filter(Boolean).join(' · ')}
                        </p>

                        {/* Why it scored what it scored, in the agent's own arithmetic. */}
                        {j.fit?.reasons?.length > 0 && (
                          <p className="mt-2 text-[11.5px] leading-relaxed text-white/50">{j.fit.reasons[0]}</p>
                        )}
                        {j.matched?.length > 0 && (
                          <p className="mt-1 text-[11.5px] text-sky-300/85">matches your {j.matched.join(', ')}</p>
                        )}
                        {j.stale && (
                          <p className="mt-1 text-[11px] text-amber-300/80">
                            posted over 30 days ago — may be filled
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
                          <a href={j.url} target="_blank" rel="noopener noreferrer"
                             className="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/70 hover:border-white/35">
                            Open posting
                          </a>
                          {j.jobId && <span className="text-[10.5px] text-white/30">{j.jobId}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* aimed searches */}
                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-xl font-semibold text-white">Aimed searches</h2>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-sky-300/80">one click</span>
                  </div>
                  <p className="mb-4 text-[12px] leading-relaxed text-white/45">
                    LinkedIn, Upwork and Fiverr have no public job API and cannot be scraped without
                    breaking their terms — so the agent composes the exact query each one understands
                    from your resume. You land on real results, already filtered.
                  </p>

                  <div className="space-y-2.5">
                    {searches.map((s) => (
                      <a
                        key={s.platform}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors hover:border-sky-400/40 hover:bg-white/[0.07]"
                      >
                        <p className="text-[14px] font-semibold text-white">{s.platform} →</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-white/50">{s.why}</p>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {materials && <MaterialsPanel data={materials} onClose={() => setMaterials(null)} />}
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
function MaterialsPanel({ data, onClose }: { data: Materials; onClose: () => void }) {
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
