import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ResumeDocument } from './ResumeDocument';
import { JobPosting } from './JobPosting';

/*
 * The agent, in two frames.
 *
 * Frame one is the statement — the reaching hands, human to machine, over
 * "WE TURN RESUMES UNREJECTABLE AND ATS FRIENDLY".
 *
 * Frame two is the product: the chat the student actually uses. It talks to
 * /api/v2/resume, which scores a resume against the nine checks an applicant
 * tracking system really runs and rebuilds the ones that fail. Nothing here
 * invents a verdict — every number comes back with the line that caused it.
 */

const ASSETS = '/assets/resume-portal';
const API = '/api/v2/resume';

type Check = { id: string; label: string; weight: number; earned: number; detail: string; fix: string | null };
type Report = {
  score: number;
  verdict: string;
  verdictText: string;
  target: string;
  stats: { words: number; bullets: number; sections: string[] };
  checks: Check[];
  failing: { label: string; fix: string; lost: number }[];
  hazards: string[];
  missingKeywords: string[];
};
type Missing = { field: string; worth: number; why: string };
type Choice = { label: string; value: string; note?: string };
type Options = {
  multi?: boolean;
  options?: Choice[];
  groups?: { group: string; options: Choice[] }[];
  other?: Choice;
};
type Msg = { role: 'user' | 'agent'; text?: string; report?: Report; resume?: string; file?: string; missing?: Missing[]; potentialScore?: number; details?: Record<string, string>; options?: Options };

/* ---------- frame one: the statement ---------- */

export function AgentHero() {
  return (
    <section id="agent" className="relative bg-white">
      <div className="relative mx-auto max-w-[1500px] px-3 pb-3 pt-3">
        <div className="relative overflow-hidden rounded-[6px]">
          <img src={`${ASSETS}/agent-hands.jpg`} alt="" className="h-[74vh] w-full object-cover" />

          {/* the thin top rule and nav, as on the reference */}
          <div className="absolute left-0 top-0 flex w-full items-center gap-7 px-7 py-5 text-[11px] font-semibold tracking-[0.14em] text-black/80">
            <span>/ SCAN</span><span>/ BUILD</span><span>/ SCORE</span><span>/ FIXES</span>
          </div>

          <h2
            className="absolute bottom-[16%] left-[4%] max-w-[62%] text-black"
            style={{ fontFamily: "'Inter', sans-serif", fontWeight: 500, fontSize: 'clamp(22px, 3.4vw, 46px)', lineHeight: 1.12, letterSpacing: '-0.01em' }}
          >
            WE TURN RESUMES
            <br />
            UNREJECTABLE AND
            <br />
            ATS FRIENDLY
          </h2>

          {/* the red signature mark */}
          <div
            className="absolute bottom-[18%] right-[6%] select-none text-[#e0203a]"
            style={{ fontFamily: "'Cinzel', serif", fontStyle: 'italic', fontSize: 'clamp(38px, 6vw, 92px)', transform: 'rotate(-4deg)' }}
          >
            TEN
          </div>

          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-semibold tracking-[0.3em] text-black/60">
            SCROLL
          </p>
        </div>
      </div>
      <div className="h-[3px] w-full bg-[#e0203a]" />
    </section>
  );
}

/* ---------- frame two: the chat ---------- */

/*
 * The empty state's offer, in the shape of the thing being asked for.
 *
 * Job hunting lives in the Job Portal, so it is not one of these: an agent
 * that offers a button it has to hand off is offering a dead end.
 */
/** A row in the job list — whatever the search returns, narrowed to what a
    row needs to show and a tailor needs to run. */
type Job = {
  title: string; company: string; location?: string; url: string;
  description?: string; tags?: string[];
  posted?: string; salary?: string; type?: string; snippet?: string;
};

/* "2 days ago" beats a timestamp on a job card: how fresh a posting is
   decides whether it is worth applying to at all. */
function ageOf(posted: string): string {
  const days = Math.floor((Date.now() - new Date(posted).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return '';
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 30) return `Posted ${days} days ago`;
  return `Posted ${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
}

const QUICK = [
  { icon: '✦', label: 'IMPROVE MY ATS SCORE', send: 'make it 98' },
  { icon: '◎', label: 'TARGET MY RESUME', send: 'tailor my resume' },
  { icon: '▤', label: 'SCORE BREAKDOWN', send: 'score breakdown' },
  { icon: '◉', label: 'MOCK INTERVIEW', send: 'mock interview' },
];

/* The rail: one glyph per thing the agent can start. */
const RAIL: { icon: string; label: string; send?: string }[] = [
  { icon: '✎', label: 'New chat' },
  { icon: '⌸', label: 'Scan a resume', send: 'scan my resume' },
  { icon: '⟐', label: 'What the ATS extracts', send: 'what does the ats see' },
  { icon: '✦', label: 'Improve my ATS score', send: 'make it 98' },
  { icon: '▤', label: 'Score breakdown', send: 'score breakdown' },
  { icon: '◎', label: 'Target a posting', send: 'tailor my resume' },
  { icon: '⌘', label: 'Keyword gaps', send: 'missing keywords' },
  { icon: '≡', label: 'My best bullets', send: 'my most relevant bullets' },
  { icon: '⧉', label: 'My versions', send: 'list my versions' },
  { icon: '◉', label: 'Mock interview', send: 'mock interview' },
  { icon: '✉', label: 'Cover letter', send: 'cover letter' },
];

/*
 * Starters, not decoration. These rows used to be mock "projects" and a fake
 * chat history — divs with hover styles and no handlers, which read as broken
 * the moment anyone clicked them. Every sidebar row now does the thing it
 * looks like it does: a starter sends its prompt, a history entry restores
 * that conversation.
 */
/* Kept for the composer's own quick-start row; the rail and the empty state
   carry the rest. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const STARTERS: [string, string][] = [
  ['Full-Stack CV', 'Build a Full-Stack Developer resume from scratch'],
  ['Data Science CV', 'Build a Data Analyst resume from scratch'],
  ['Internship CV', 'Build a Software Engineering Intern resume from scratch'],
  ['Cover Letter', 'cover letter'],
];

type Archive = { title: string; at: number; msgs: Msg[]; session: Record<string, unknown> | null };

const ARCHIVE_KEY = 'ten_resume_agent_archives';

function loadArchives(): Archive[] {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'); } catch { return []; }
}
function saveArchives(list: Archive[]) {
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* full */ }
}

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';
  return (
    <div className="flex items-center gap-4">
      <div
        className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(${tone} ${score * 3.6}deg, #e9edf3 0deg)` }}
      >
        <div className="grid h-[62px] w-[62px] place-items-center rounded-full bg-white">
          <span className="text-[20px] font-bold" style={{ color: tone }}>{score}</span>
        </div>
      </div>
      <div>
        <p className="text-[13px] font-bold text-[#1f2937]">ATS score {score}/100</p>
        <p className="mt-0.5 text-[12px] leading-snug text-[#6b7280]">Nine checks, weighted the way a parser weighs them.</p>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: Report }) {
  return (
    <div className="rounded-2xl border border-[#e5e9f0] bg-white p-5">
      <ScoreRing score={report.score} />
      <p className="mt-4 text-[13px] font-semibold text-[#1f2937]">{report.verdictText}</p>

      <div className="mt-4 space-y-2">
        {report.checks.map((c) => {
          const pct = Math.round((c.earned / c.weight) * 100);
          const tone = pct >= 85 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
          return (
            <div key={c.id} className="flex items-center gap-3">
              <span className="w-[190px] shrink-0 text-[12px] text-[#374151]">{c.label}</span>
              <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-[#eef1f6]">
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
              </span>
              <span className="w-[86px] shrink-0 text-right text-[11px] text-[#6b7280]">{c.detail}</span>
            </div>
          );
        })}
      </div>

      {report.failing.length > 0 && (
        <div className="mt-5 rounded-xl bg-[#fff7f7] p-4">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-[#dc2626]">What is costing you shortlists</p>
          <ul className="space-y-2">
            {report.failing.slice(0, 5).map((f) => (
              <li key={f.label} className="text-[12.5px] leading-relaxed text-[#374151]">
                <b>{f.label}</b> — {f.fix}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.missingKeywords.length > 0 && (
        <p className="mt-4 text-[12px] leading-relaxed text-[#6b7280]">
          <b className="text-[#374151]">Missing {report.target} keywords:</b> {report.missingKeywords.slice(0, 8).join(', ')}
        </p>
      )}
    </div>
  );
}

/*
 * The agent's reply, with pipe tables drawn as tables.
 *
 * The tailor step answers with a mapping table — every term the posting asks
 * for, whether the resume evidences it, and where. Rendered as pre-wrapped
 * text in a proportional font, those rows arrive as a wall of pipes with
 * nothing lining up, which reads as broken rather than as analysis. Splitting
 * the reply into prose and table blocks is about twenty lines and needs no
 * markdown dependency; anything the agent formats as a table from here on
 * renders as one.
 */
function isTableRow(line: string) {
  return /^\s*\|.*\|\s*$/.test(line);
}
function cellsOf(line: string) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}
/* Markdown marks the header with a |---|---| separator row. */
const isDividerRow = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

function ReplyBody({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: Array<{ kind: 'text'; lines: string[] } | { kind: 'table'; rows: string[][] }> = [];

  lines.forEach((line) => {
    const last = blocks[blocks.length - 1];
    if (isTableRow(line)) {
      if (isDividerRow(line)) return; /* structural, never shown */
      if (last && last.kind === 'table') last.rows.push(cellsOf(line));
      else blocks.push({ kind: 'table', rows: [cellsOf(line)] });
      return;
    }
    if (last && last.kind === 'text') last.lines.push(line);
    else blocks.push({ kind: 'text', lines: [line] });
  });

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.kind === 'text') {
          const body = b.lines.join('\n').trim();
          if (!body) return null;
          /* The agent bolds the one line it wants read first — the bullet it
             is asking about. Printed raw, the asterisks read as noise. */
          return (
            <p key={i} className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#374151]">
              {body.split(/\*\*([^*]+)\*\*/).map((part, n) =>
                n % 2 ? <b key={n} className="text-[#111827]">{part}</b> : part)}
            </p>
          );
        }
        const [head, ...rest] = b.rows;
        return (
          <div key={i} className="overflow-x-auto rounded-xl border border-[#e5e9f0]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[#f6f8fb] text-left text-[#6b7280]">
                  {head.map((h, j) => <th key={j} className="px-3 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rest.map((r, j) => (
                  <tr key={j} className="border-t border-[#eef1f6] align-top">
                    {r.map((c, k) => (
                      <td key={k} className="px-3 py-2 text-[#374151]">
                        {/* The agent italicises "(nice to have)" — the only
                            inline markup these cells ever carry. */}
                        {c.split(/\*([^*]+)\*/).map((part, n) =>
                          n % 2 ? <i key={n} className="text-[#6b7280]">{part}</i> : part)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/*
 * The answers to a question, offered rather than demanded.
 *
 * A blank prompt is the hardest kind of question to answer well: "which
 * company is the letter for?" got back "amazon" and nothing else, and the
 * letter was written on that alone. Picking from a list is faster and gives
 * the agent a fact it can rely on — and the last chip is always the way out,
 * because a menu you cannot answer outside of is worse than no menu.
 */
function ChoiceList({ options, onPick, disabled }: {
  options: Options; onPick: (value: string) => void; disabled: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  /*
   * Several answers, when the question asks for several.
   *
   * The server had been sending `multi: true` on the project and skill
   * questions for a while and this ignored it — every chip submitted on the
   * first click, so "pick as many as you want to build" accepted exactly one
   * and the student watched the rest of the list disappear. Selected chips
   * stay lit and nothing is sent until Done.
   */
  const [picked, setPicked] = useState<string[]>([]);
  const multi = Boolean(options.multi);

  const groups = options.groups || (options.options ? [{ group: '', options: options.options }] : []);
  /* Long lists collapse: fifteen chips is a menu, ninety is a wall. */
  const LIMIT = 12;
  const total = groups.reduce((n, g) => n + g.options.length, 0);
  const collapsed = !showAll && total > LIMIT;

  const chip = (c: Choice, key: string) => {
    const value = c.value || c.label;
    const on = picked.includes(value);
    return (
      <button
        key={key}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!multi) return onPick(value);
          setPicked((p) => (on ? p.filter((x) => x !== value) : [...p, value]));
        }}
        className={[
          'rounded-full border px-3 py-1.5 text-left text-[12.5px] transition disabled:opacity-50',
          on
            ? 'border-[#2563eb] bg-[#eff4ff] text-[#1d4ed8]'
            : 'border-[#d9e0ea] bg-white text-[#374151] hover:border-[#2563eb] hover:text-[#2563eb]',
        ].join(' ')}
      >
        {multi && <span className="mr-1.5 text-[11px]">{on ? '☑' : '☐'}</span>}
        {c.label}
        {/* The separator is a character, not only a margin: copied text and
            screen readers both flatten the gap and ran the two together. */}
        {c.note && <span className="ml-1.5 text-[11px] text-[#9ca3af]">· {c.note}</span>}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {groups.map((g, gi) => {
        const shown = collapsed ? g.options.slice(0, Math.max(2, Math.floor(LIMIT / groups.length))) : g.options;
        if (!shown.length) return null;
        return (
          <div key={gi}>
            {g.group && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">{g.group}</p>}
            <div className="flex flex-wrap gap-1.5">{shown.map((c, i) => chip(c, `${gi}-${i}`))}</div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {multi && (
          <>
            <button
              type="button"
              disabled={disabled || !picked.length}
              onClick={() => onPick(picked.join(', '))}
              className="rounded-full bg-[#2563eb] px-4 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1d4ed8] disabled:opacity-40"
            >
              {picked.length ? `Use these ${picked.length}` : 'Pick at least one'}
            </button>
            {picked.length > 0 && (
              <button type="button" onClick={() => setPicked([])}
                className="text-[12px] text-[#6b7280] hover:text-[#111827]">
                Clear
              </button>
            )}
          </>
        )}
        {collapsed && (
          <button type="button" onClick={() => setShowAll(true)}
            className="text-[12px] font-semibold text-[#2563eb] hover:underline">
            Show all {total}
          </button>
        )}
        {/* The escape hatch, never hidden behind "show all". */}
        {options.other && (
          <span className="text-[12px] text-[#6b7280]">
            {options.other.label} — just type it below.
          </span>
        )}
      </div>
    </div>
  );
}

/*
 * Fetches the rendered PDF and hands it to the browser. Posting rather than
 * linking keeps the details out of the URL bar and out of server logs.
 */
async function downloadPdf(details: Record<string, string>) {
  const res = await fetch(`${API}/build.pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ details }),
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(details.name || 'resume').replace(/[^A-Za-z0-9]+/g, '-')}-TEN.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AgentChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /* Which of the three things is on screen. The agent switches it when a
     reply arrives about one of the others, so finding a job puts the jobs in
     front of you without a click. */
  const [tab, setTab] = useState<'resume' | 'jobs' | 'cover'>('jobs');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [letter, setLetter] = useState('');
  /* The row they opened. Clicking a job shows the role before anything is
     rewritten, because "tailor for this" is a decision and a decision needs
     the posting in front of it. */
  const [openJob, setOpenJob] = useState<Job | null>(null);
  /* Whether the pane is showing the rewritten page or the list it came from. */
  const [showTailored, setShowTailored] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  /*
   * The conversation's memory. The server asks its interview questions one at
   * a time and needs the answers to land on the question that asked them —
   * without echoing this back, every answer fell through the keyword router
   * and the agent repeated the same reply forever. That was the entire
   * "it keeps repeating itself" bug.
   */
  const sessionRef = useRef<Record<string, unknown> | null>(
    /* The agent's memory across visits: the fact ledger, target and shipped
       resume survive a reload, so a returning student is not interviewed
       from zero. New Chat wipes it deliberately. */
    (() => {
      try { return JSON.parse(localStorage.getItem('ten_resume_agent_session') || 'null'); }
      catch { return null; }
    })()
  );
  const persistSession = (s: Record<string, unknown> | null) => {
    sessionRef.current = s;
    try {
      if (s) localStorage.setItem('ten_resume_agent_session', JSON.stringify(s));
      else localStorage.removeItem('ten_resume_agent_session');
    } catch { /* storage full or blocked — memory lives for the tab only */ }
  };

  const started = msgs.length > 0;

  /* Real history: archived conversations, restored on click. */
  const [archives, setArchives] = useState<Archive[]>(loadArchives);
  const [filter, setFilter] = useState('');
  const [searching, setSearching] = useState(false);

  function archiveCurrent() {
    if (!msgs.length) return;
    const firstUser = msgs.find((m) => m.role === 'user');
    const entry: Archive = {
      title: (firstUser?.text || firstUser?.file || 'Conversation').slice(0, 48),
      at: Date.now(),
      msgs,
      session: sessionRef.current,
    };
    const next = [entry, ...archives].slice(0, 12);
    setArchives(next);
    saveArchives(next);
  }

  function newChat() {
    archiveCurrent();
    setMsgs([]);
    persistSession(null);
  }

  function restore(a: Archive) {
    archiveCurrent();
    setMsgs(a.msgs);
    persistSession(a.session);
    const rest = archives.filter((x) => x !== a);
    setArchives(rest);
    saveArchives(rest);
  }

  const dayOf = (at: number) => {
    const d = new Date(at); const today = new Date();
    return d.toDateString() === today.toDateString() ? 'TODAY' : 'EARLIER';
  };

  async function send(text: string, file?: File) {
    if (!text.trim() && !file) return;
    setMsgs((m) => [...m, { role: 'user', text: text || 'Scan this resume', file: file?.name }]);
    setInput('');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('message', text || 'scan my resume');
      if (file) body.append('file', file);
      if (sessionRef.current) body.append('session', JSON.stringify(sessionRef.current));
      const res = await fetch(`${API}/chat`, { method: 'POST', body });
      // Read the body before judging the response. A 429 from the rate limiter
      // and a validation error from the agent both arrive as perfectly good
      // JSON, and treating every non-ok reply as "unreachable" is what made a
      // rate limit look like a dead server.
      let data: any = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok || !data || !data.ok) {
        const reason = (data && (data.error || data.message))
          || (res.status === 429 ? 'Too many requests just now — wait a moment and try again.' : '')
          || `The agent replied with an error (HTTP ${res.status}).`;
        setMsgs((m) => [...m, { role: 'agent', text: reason }]);
        setBusy(false);
        return;
      }
      if (data.session) persistSession(data.session);

      /*
       * The reply decides which panel you are looking at.
       *
       * Asking for jobs and then having to find the jobs tab is a step that
       * only exists because the tabs exist. Whatever the agent just produced
       * is what comes to the front.
       */
      if (Array.isArray(data.jobs) && data.jobs.length) {
        /* Real openings need a destination; the big-tech targets at the end
           of the list deliberately have none — they are something to tailor
           against, not something to click through to. */
        setJobs(data.jobs.filter((j: Job) => j.aspirational || /^https?:\/\//.test(String(j.url || ''))));
        /* A fresh search closes whatever posting was open — the detail on
           screen would belong to the previous list. */
        setOpenJob(null);
        setTab('jobs');
      }
      if (data.letter || (data.kind === 'help' && /^Dear |Sincerely,/m.test(String(data.reply || '')))) {
        setLetter(String(data.letter || data.reply || ''));
        setTab('cover');
      }

      if (data.kind === 'scan') {
        setMsgs((m) => [...m, { role: 'agent', report: data.report, text: data.prompt || undefined }]);
        /* A resume arriving is the start of a search, not the end of one:
           scanning it is what the hunt is built from. */
        if (data.session && String(data.session.resumeText || '').trim() && !jobs.length) {
          setTimeout(() => send('find me jobs'), 400);
        }
      } else if (data.kind === 'build') {
        /* A rewrite shows the page it produced, in the pane you were in. */
        setShowTailored(true);
        setOpenJob(null);
        setMsgs((m) => [...m, { role: 'agent', resume: data.text, report: data.report, missing: data.missing, potentialScore: data.potentialScore, details: data.details, text: data.reply || undefined }]);
      } else setMsgs((m) => [...m, { role: 'agent', text: data.reply, options: data.options }]);
    } catch {
      // Only a real network failure reaches here now.
      setMsgs((m) => [...m, { role: 'agent', text: 'Could not reach the server. Check your connection and try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(input); };

  /*
   * The document under discussion: the newest page the agent has produced, or
   * the one that was uploaded before it produced anything.
   */
  const latestResume = [...msgs].reverse().find((m) => m.resume)?.resume
    || (sessionRef.current && (sessionRef.current as { resumeText?: string }).resumeText)
    || '';
  const latestDetails = [...msgs].reverse().find((m) => m.details)?.details || {};
  const docName = String(latestDetails.name || 'Your resume').replace(/\s+/g, '_');

  /*
   * Three tabs, because the agent does three things.
   *
   * It briefly had ten pages and a navigation rail — a dashboard, a sample
   * library, a settings screen — in front of a student who wanted to fix one
   * resume. Build it, find work, write the letter. Everything else was
   * scaffolding around those three, and scaffolding is what you remove.
   */
  /*
   * Two tabs, because there are two things to do.
   *
   * A RESUME tab invited people to rewrite a page in the abstract, which is
   * the one thing this tool cannot do well — a resume is only tailored
   * against something. The work starts with a job, so it starts in Job
   * Search: pick the position, read the role, tailor for it. The tailored
   * page appears in that same pane, which is where you were looking.
   */
  /* Not "Job Search": that is the Job Portal's name, and two things called
     the same thing in one product is a support ticket waiting to happen.
     This one finds a role in order to rewrite your page against it. */
  const tabs = [
    { id: 'jobs' as const, label: 'RESUME BUILDER' },
    { id: 'cover' as const, label: 'COVER LETTER' },
  ];

  return (
    <section id="agent" className="bg-[#f6f8fb] px-3 py-6 text-[#111827]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="mx-auto flex max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-[#e5e9f0] bg-white"
           style={{ height: 'min(780px, 88vh)' }}>

        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#eef1f6] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[#2563eb] text-[13px] text-white">✦</span>
            <b className="text-[13.5px]">TEN Resume AI</b>
          </div>

          <div className="flex gap-1 rounded-full bg-[#f3f4f6] p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  /*
                   * A tab starts its own work.
                   *
                   * Job Search opened on "Say 'find me jobs' and I will
                   * search" — a screen telling you the magic words instead of
                   * doing the thing you just clicked. The tab is the request.
                   */
                  if (busy) return;
                  if (t.id === 'jobs' && !jobs.length) send('find me jobs');
                  if (t.id === 'cover' && !letter) send('cover letter');
                }}
                className={[
                  'rounded-full px-3 py-1 text-[11.5px] font-semibold tracking-wide transition-colors',
                  tab === t.id ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6b7280] hover:text-[#111827]',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            onClick={newChat}
            className="rounded-full border border-[#e5e9f0] px-3 py-1.5 text-[11.5px] font-semibold text-[#6b7280] hover:border-[#c7d2fe] hover:text-[#111827]"
          >
            New chat
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ── the document, or the job, or the letter ── */}
          <div className="hidden min-w-0 flex-1 flex-col border-r border-[#eef1f6] lg:flex">
            <div className="flex shrink-0 items-center gap-2 border-b border-[#eef1f6] px-4 py-2.5">
              <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                {tab === 'jobs' ? (showTailored ? docName : 'Resume builder') : 'Cover letter'}
              </p>
              {tab === 'jobs' && showTailored && latestResume && (
                <>
                  <button onClick={() => navigator.clipboard?.writeText(latestResume)}
                    className="rounded-lg border border-[#d1d5db] px-2.5 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#f3f4f6]">Copy</button>
                  <button onClick={() => downloadPdf(latestDetails)}
                    className="rounded-lg bg-[#2563eb] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1d4ed8]">Download PDF</button>
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[#f6f8fb] p-5">
              {tab === 'jobs' && (
                /*
                 * The tailored page appears where the work happened.
                 *
                 * With no RESUME tab, a rewrite that landed in another pane
                 * would land nowhere — so the newest version shows here,
                 * above the openings, with a way back to the list.
                 */
                showTailored && latestResume ? (
                  <div className="mx-auto max-w-[760px]">
                    <button onClick={() => setShowTailored(false)}
                      className="mb-2.5 text-[12px] text-[#6b7280] hover:text-[#111827]">
                      ← Back to openings
                    </button>
                    <ResumeDocument text={latestResume} />
                  </div>
                ) : openJob ? (
                  /* ── the role, before anything is rewritten ── */
                  <div className="mx-auto max-w-[760px]">
                    <div className="mb-2.5 flex items-center gap-1.5 text-[12px]">
                      <button onClick={() => setOpenJob(null)} className="text-[#6b7280] hover:text-[#111827]">
                        Job Search
                      </button>
                      <span className="text-[#9ca3af]">/</span>
                      <span className="truncate text-[#9ca3af]">{openJob.title}</span>
                    </div>
                    <JobPosting
                      job={openJob}
                      busy={busy}
                      /* Starts the conversation, not the rewrite: the agent
                         asks before it changes the page you are working on. */
                      onTailor={() => send(`I want to tailor my resume for the ${openJob.title} role at ${openJob.company}`)}
                    />
                  </div>
                ) : jobs.length ? (
                  <div className="mx-auto max-w-[760px] space-y-3">
                    {jobs.map((j, i) => (
                      /* The whole card opens the posting. Deciding to tailor
                         without reading the role is not a decision. */
                      <button
                        key={j.url + i}
                        onClick={() => setOpenJob(j)}
                        className="block w-full rounded-xl border border-[#e5e9f0] bg-white p-4 text-left transition-colors hover:border-[#c7d2fe] hover:shadow-[0_1px_6px_rgba(16,24,40,0.06)]"
                      >
                        <p className="text-[14.5px] font-semibold leading-snug text-[#111827]">{j.title}</p>
                        <p className="mt-0.5 text-[12.5px] text-[#374151]">{j.company}</p>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#6b7280]">
                          {j.location && <span>📍 {j.location}</span>}
                          {j.salary && <span>💰 {j.salary}</span>}
                          {j.type && <span>🕐 {j.type}</span>}
                        </div>

                        {j.snippet && (
                          <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[#6b7280]">
                            {j.snippet.slice(0, 170)}
                            {j.snippet.length > 170 ? '…' : ''}
                          </p>
                        )}

                        {j.tags && j.tags.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {j.tags.slice(0, 6).map((t) => (
                              <span key={t} className="rounded bg-[#f3f4f6] px-2 py-0.5 text-[11px] text-[#374151]">{t}</span>
                            ))}
                          </div>
                        )}

                        {j.posted && (
                          <p className="mt-2.5 text-[11.5px] text-[#059669]">{ageOf(j.posted)}</p>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-10 text-center text-[12.5px] leading-relaxed text-[#9ca3af]">
                    {busy
                      ? 'Searching the boards…'
                      : 'Attach your resume, or name the role you are after, and the openings land here.'}
                    <br />Every row opens a real listing, or it is not shown.
                  </p>
                )
              )}

              {tab === 'cover' && (
                letter
                  ? <pre className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#374151]">{letter}</pre>
                  : <p className="mt-10 text-center text-[12.5px] text-[#9ca3af]">
                      Say “write a cover letter” and I will ask which role it is for.
                    </p>
              )}
            </div>
          </div>

          {/* ── the conversation ── */}
          <div className="flex min-w-0 flex-1 flex-col lg:max-w-[430px]">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {/*
                * No menu of three. This seat does one errand.
                *
                * "Fix my resume · Find me jobs · Write a cover letter" was a
                * front door in front of a front door: the tabs already say
                * which of those you are in, and the agent's whole purpose is
                * those three things. Asking somebody to choose the thing they
                * came for is a click that teaches them nothing. Attach a
                * resume, or say what you want, and it starts.
                */}
              {!started && (
                <div className="pt-10">
                  <p className="text-center text-[13px] leading-relaxed text-[#6b7280]">
                    Attach your resume and I will read it, find the openings for what
                    it says you are, and rewrite it for whichever one you pick.
                  </p>
                </div>
              )}

              {msgs.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  {m.role === 'user' ? (
                    <div className="max-w-[85%] rounded-2xl bg-[#2563eb] px-3.5 py-2 text-[13px] text-white">
                      {m.text}
                      {m.file && <span className="mt-1 block text-[11px] opacity-80">📎 {m.file}</span>}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {m.text && <ReplyBody text={m.text} />}
                      {/* Only the newest question is answerable — older chips
                          would answer something already left behind. */}
                      {m.options && i === msgs.length - 1 && (
                        <ChoiceList options={m.options} disabled={busy} onPick={(v) => send(v)} />
                      )}
                      {m.resume && (
                        <p className="rounded-xl border border-[#c7d2fe] bg-[#f5f7ff] px-3 py-2 text-[12px] text-[#374151]">
                          Resume updated — it is on the left, ready to download.
                        </p>
                      )}
                      {m.report && <ReportCard report={m.report} />}
                    </div>
                  )}
                </div>
              ))}

              {busy && <p className="text-[12.5px] text-[#9ca3af]">Working…</p>}
              <div ref={endRef} />
            </div>

            <div className="border-t border-[#eef1f6] px-3 py-3">
              <Composer {...{ input, setInput, onSubmit, fileRef, send, busy }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Composer({ input, setInput, onSubmit, fileRef, send, busy }: {
  input: string; setInput: (v: string) => void; onSubmit: (e: FormEvent) => void;
  fileRef: React.RefObject<HTMLInputElement>; send: (t: string, f?: File) => void; busy: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="w-full rounded-2xl border border-white/10 bg-[#0f121a] p-3 focus-within:border-[#5b5bd6]">
      {/*
        A textarea, because the agent keeps asking people to paste things.
        "Attach or paste the resume", "paste the job description" — and a
        single-line <input> silently joins every pasted line into one, so a
        pasted resume arrived as one continuous string with no headings and
        no bullets for the parser to find. Enter still sends; Shift+Enter is
        the newline, as in every chat box.
      */}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(e as unknown as FormEvent); }
        }}
        rows={1}
        placeholder="Ask me anything, or paste a resume or job description…"
        className="max-h-[220px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-[#e7e9ee] outline-none placeholder:text-[#6b7280]"
        style={{ height: 'auto', minHeight: '2rem' }}
        onInput={(e) => {
          /* Grows with the paste instead of hiding it behind a scrollbar. */
          const t = e.currentTarget;
          t.style.height = 'auto';
          t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        {/* Word files are what most people actually keep a resume in, and
            they used to fall through to a raw-bytes read. */}
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) send('Scan this resume', f); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11.5px] font-semibold tracking-wide text-[#c7cbd6] hover:bg-white/[0.08]">
          <span>⌸</span> ATTACH A RESUME
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[#6b7280]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" /> TEN-ATS-Engine
        </span>
        <button type="submit" disabled={busy}
          className="grid h-8 w-8 place-items-center rounded-full bg-[#5b5bd6] text-[13px] text-white hover:bg-[#6b6be0] disabled:opacity-50">↑</button>
      </div>
    </form>
  );
}
