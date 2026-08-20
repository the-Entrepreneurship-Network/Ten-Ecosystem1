import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

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
type Msg = { role: 'user' | 'agent'; text?: string; report?: Report; resume?: string; file?: string; missing?: Missing[]; potentialScore?: number; details?: Record<string, string> };

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

const QUICK = [
  { icon: '🔍', label: 'ATS Deep Scan', send: 'scan my resume' },
  { icon: '📄', label: 'Build Resume', send: 'build me a resume' },
  { icon: '📊', label: 'Get My Score', send: 'score my resume' },
  { icon: '⚡', label: 'Fix Rejections', send: 'why do I get rejected' },
];

/*
 * Starters, not decoration. These rows used to be mock "projects" and a fake
 * chat history — divs with hover styles and no handlers, which read as broken
 * the moment anyone clicked them. Every sidebar row now does the thing it
 * looks like it does: a starter sends its prompt, a history entry restores
 * that conversation.
 */
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
          return (
            <p key={i} className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#374151]">{body}</p>
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
      if (data.kind === 'scan') setMsgs((m) => [...m, { role: 'agent', report: data.report, text: data.prompt || undefined }]);
      else if (data.kind === 'build') setMsgs((m) => [...m, { role: 'agent', resume: data.text, report: data.report, missing: data.missing, potentialScore: data.potentialScore, details: data.details, text: data.reply || undefined }]);
      else setMsgs((m) => [...m, { role: 'agent', text: data.reply }]);
    } catch {
      // Only a real network failure reaches here now.
      setMsgs((m) => [...m, { role: 'agent', text: 'Could not reach the server. Check your connection and try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(input); };

  return (
    <section className="bg-[#f6f8fb] px-3 py-6 text-[#111827]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="mx-auto flex max-w-[1400px] overflow-hidden rounded-2xl border border-[#e5e9f0] bg-white" style={{ height: 'min(760px, 88vh)' }}>

        {/* ── sidebar ── */}
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#eef1f6] bg-[#fbfcfe] p-4 md:flex">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-[#2563eb] text-[13px] text-white">✦</span>
              <b className="text-[14px]">TEN Resume AI</b>
            </div>
            <span className="text-[#9ca3af]">▤</span>
          </div>

          <button onClick={newChat} className="mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-[#374151] hover:bg-[#eef2ff]">
            <span>✎</span> New Chat
          </button>
          <button onClick={() => { setSearching(!searching); setFilter(''); }}
                  className="mb-2 flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-[#374151] hover:bg-[#eef2ff]">
            <span>⌕</span> Search
          </button>
          {searching && (
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter your chats…"
              className="mb-3 rounded-lg border border-[#e5e9f0] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#c7d2fe]"
            />
          )}

          {/* The middle of the sidebar scrolls; the account card stays put. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold text-[#9ca3af]">Start a resume</span>
            </div>
            {STARTERS.map(([name, prompt]) => (
              <button key={name} onClick={() => send(prompt)} disabled={busy}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] text-[#374151] hover:bg-[#eef2ff] disabled:opacity-50">
                <span className="truncate">{name}</span><span className="text-[11px] text-[#9ca3af]">→</span>
              </button>
            ))}

            {(['TODAY', 'EARLIER'] as const).map((bucket) => {
              const rows = archives.filter((a) => dayOf(a.at) === bucket &&
                (!filter || a.title.toLowerCase().includes(filter.toLowerCase())));
              if (!rows.length) return null;
              return (
                <div key={bucket}>
                  <p className="mb-1 mt-5 px-2 text-[11px] font-semibold text-[#9ca3af]">{bucket}</p>
                  {rows.map((a) => (
                    <button key={a.at} onClick={() => restore(a)}
                      className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-[13px] text-[#374151] hover:bg-[#eef2ff]">
                      {a.title}
                    </button>
                  ))}
                </div>
              );
            })}
            {!archives.length && (
              <p className="mt-5 px-2 text-[12px] leading-relaxed text-[#9ca3af]">
                Your chats appear here after you start one. New Chat files the current one away; clicking it brings it back.
              </p>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#eef1f6] bg-white p-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e0e7ff] text-[12px] font-bold text-[#3730a3]">TE</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold">TEN Student</p>
              <p className="text-[11px] text-[#9ca3af]">Free</p>
            </div>
            <a href="/student-login.html" className="rounded-md bg-[#2563eb] px-2.5 py-1 text-[11px] font-semibold text-white">Upgrade</a>
          </div>
        </aside>

        {/* ── main ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-5 py-8">
            {!started ? (
              <div className="flex h-full flex-col items-center justify-center">
                <h3 className="text-center text-[28px] font-semibold text-[#2563eb] md:text-[32px]">Hey, How Can I Assist?</h3>
                <p className="mt-3 max-w-[430px] text-center text-[13px] leading-relaxed text-[#6b7280]">
                  TEN Resume AI scans your resume against what an ATS really parses — and rebuilds it
                  when it would be filtered out.
                </p>
                <Composer {...{ input, setInput, onSubmit, fileRef, send, busy }} />
                <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                  {QUICK.map((q) => (
                    <button key={q.label} onClick={() => send(q.send)}
                      className="flex items-center gap-2 rounded-full border border-[#e5e9f0] bg-white px-4 py-2 text-[12.5px] text-[#374151] transition-colors hover:border-[#c7d2fe] hover:bg-[#f5f7ff]">
                      <span>{q.icon}</span> {q.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-[760px] space-y-5">
                {msgs.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                    {m.role === 'user' ? (
                      <div className="max-w-[80%] rounded-2xl bg-[#2563eb] px-4 py-2.5 text-[13.5px] text-white">
                        {m.text}
                        {m.file && <span className="mt-1 block text-[11px] opacity-80">📎 {m.file}</span>}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {m.text && <ReplyBody text={m.text} />}
                        {m.resume && (
                          <div className="rounded-2xl border border-[#e5e9f0] bg-[#fbfcfe] p-4">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <b className="text-[12px] uppercase tracking-wider text-[#6b7280]">Your ATS-ready resume</b>
                              <div className="flex gap-2">
                                <button onClick={() => navigator.clipboard?.writeText(m.resume!)}
                                  className="rounded-md border border-[#d1d5db] px-2.5 py-1 text-[11px] font-semibold text-[#374151]">Copy</button>
                                <button onClick={() => downloadPdf(m.details || {})}
                                  className="rounded-md bg-[#2563eb] px-2.5 py-1 text-[11px] font-semibold text-white">Download PDF</button>
                              </div>
                            </div>
                            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-[#374151]">{m.resume}</pre>
                          </div>
                        )}
                        {m.missing && m.missing.length > 0 && (
                          <div className="rounded-2xl border border-[#ffe0b2] bg-[#fffaf3] p-4">
                            <p className="mb-1 text-[12px] font-bold uppercase tracking-wider text-[#b45309]">
                              Give me these and it reaches {m.potentialScore}/100
                            </p>
                            <ul className="mt-2 space-y-1.5">
                              {m.missing.map((f) => (
                                <li key={f.field} className="text-[12.5px] leading-relaxed text-[#374151]">
                                  <b>{f.field}</b> <span className="text-[#b45309]">+{f.worth}</span> — {f.why}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {m.report && <ReportCard report={m.report} />}
                      </div>
                    )}
                  </div>
                ))}
                {busy && <p className="text-[13px] text-[#9ca3af]">Reading and scoring…</p>}
              </div>
            )}
          </div>

          {started && (
            <div className="border-t border-[#eef1f6] px-5 py-4">
              <div className="mx-auto max-w-[760px]">
                <Composer {...{ input, setInput, onSubmit, fileRef, send, busy }} />
              </div>
            </div>
          )}
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
    <form onSubmit={onSubmit} className="mt-7 w-full max-w-[560px] rounded-2xl border border-[#e5e9f0] bg-white p-3 shadow-[0_2px_10px_rgba(16,24,40,0.04)]">
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
        className="max-h-[220px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-[#111827] outline-none placeholder:text-[#9ca3af]"
        style={{ height: 'auto', minHeight: '2rem' }}
        onInput={(e) => {
          /* Grows with the paste instead of hiding it behind a scrollbar. */
          const t = e.currentTarget;
          t.style.height = 'auto';
          t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => fileRef.current?.click()} className="text-[#6b7280] hover:text-[#111827]" aria-label="Attach resume">📎</button>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) send('Scan this resume', f); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] text-[#374151] hover:bg-[#f3f4f6]">
          <span>⌸</span> Resume
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-[#6b7280]">
          <span className="h-2 w-2 rounded-full bg-[#f59e0b]" /> TEN-ATS-Engine ▾
        </span>
        <button type="submit" disabled={busy}
          className="grid h-7 w-7 place-items-center rounded-full bg-[#e5e9f0] text-[13px] text-[#6b7280] disabled:opacity-50">↑</button>
      </div>
    </form>
  );
}
