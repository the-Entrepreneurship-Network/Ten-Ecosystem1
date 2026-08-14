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
type Job = { source: string; title: string; company: string; location: string; type: string; tags: string[]; url: string; posted: string | null; matched: string[]; score: number };
type Search = { platform: string; why: string; url: string };
type SourceStat = { name: string; ok: boolean; count: number; error: string | null };

export default function JobAgent() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [sources, setSources] = useState<SourceStat[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
                      <a
                        key={j.url + i}
                        href={j.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/[0.07]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[14.5px] font-semibold leading-snug text-white">{j.title}</p>
                          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-wide text-white/60">{j.source}</span>
                        </div>
                        <p className="mt-1 text-[12.5px] text-white/55">
                          {[j.company, j.location, j.type].filter(Boolean).join(' · ')}
                        </p>
                        {j.matched.length > 0 && (
                          <p className="mt-2 text-[11.5px] text-sky-300/85">matches your {j.matched.join(', ')}</p>
                        )}
                      </a>
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
    </KineticGrid>
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
