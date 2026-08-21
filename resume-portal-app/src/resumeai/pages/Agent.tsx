import { useEffect, useRef, useState } from 'react';
import { send, type Options, type Report } from '../api';
import { setSession, useSession } from '../store';
import { Busy, Button, Card, Checks, Choices, Empty, Problem, Reply, inputClass } from '../ui';

type Msg = {
  role: 'you' | 'agent';
  text?: string;
  report?: Report;
  resume?: string;
  options?: Options;
  file?: string;
};

const CHIPS = [
  ['Check', 'scan my resume'],
  ['Build', 'build a resume from scratch'],
  ['Tailor', 'tailor my resume'],
  ['Raise 98', 'make it 98'],
  ['Keywords', 'missing keywords'],
  ['Cover', 'cover letter'],
] as const;

/**
 * The conversation, with the document beside it.
 *
 * The resume is the thing being worked on; a chat log is a poor place to
 * keep it, so it lives in its own pane and the thread says what changed.
 */
export default function Agent() {
  const session = useSession();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  async function run(message: string, file?: File) {
    setMsgs((m) => [...m, { role: 'you', text: message, file: file?.name }]);
    setInput('');
    setBusy(true);
    setErr('');

    const out = await send(message, { file, session });
    setBusy(false);
    if (!out.ok) {
      setErr(out.error || 'That did not work.');
      return;
    }
    setSession(out.session);
    setMsgs((m) => [
      ...m,
      {
        role: 'agent',
        text: out.reply || undefined,
        report: out.report,
        resume: out.kind === 'build' ? out.text : undefined,
        options: out.options,
      },
    ]);
  }

  const doc =
    [...msgs].reverse().find((m) => m.resume)?.resume || String(session.resumeText || '');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      <Card title="Agent">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CHIPS.map(([label, cmd]) => (
            <button
              key={label}
              disabled={busy}
              onClick={() => run(cmd)}
              className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11.5px] text-[var(--mute)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-45"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
          {!msgs.length && (
            <Empty>Ask for anything — a score, a rewrite, a cover letter. The commands above are shortcuts.</Empty>
          )}
          {msgs.map((m, i) =>
            m.role === 'you' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-[12px] bg-[var(--raised)] px-3 py-2 text-[12.5px]">
                  {m.text}
                  {m.file && <span className="mt-0.5 block text-[11px] text-[var(--mute)]">📎 {m.file}</span>}
                </div>
              </div>
            ) : (
              <div key={i} className="space-y-2.5">
                {m.text && <Reply text={m.text} />}
                {/* Only the newest question is answerable — older chips would
                    answer something the conversation has already left. */}
                {m.options && i === msgs.length - 1 && (
                  <Choices options={m.options} disabled={busy} onPick={(v) => run(v)} />
                )}
                {m.resume && (
                  <p className="rounded-[10px] border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-3 py-2 text-[12px]">
                    Resume updated — it is on the right.
                  </p>
                )}
                {m.report && (
                  <div className="rounded-[10px] border border-[var(--line)] p-3">
                    <p className="mb-2 text-[12.5px] font-semibold">Resume AI score: {m.report.score}/100</p>
                    <Checks report={m.report} />
                  </div>
                )}
              </div>
            ),
          )}
          {busy && <Busy>Reading and scoring…</Busy>}
          {err && <Problem>{err}</Problem>}
          <div ref={endRef} />
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) run(input.trim());
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run('Scan this resume', f);
              e.target.value = '';
            }}
          />
          <Button kind="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            📎
          </Button>
          <input
            className={inputClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything, or paste a resume or job description…"
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            Send
          </Button>
        </form>
      </Card>

      <Card
        title="Your resume"
        actions={
          doc ? (
            <Button kind="ghost" onClick={() => navigator.clipboard?.writeText(doc)}>
              Copy
            </Button>
          ) : undefined
        }
      >
        {doc ? (
          <pre className="max-h-[68vh] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--mute)]">
            {doc}
          </pre>
        ) : (
          <Empty>Upload or build a resume and it appears here, updating as the agent changes it.</Empty>
        )}
      </Card>
    </div>
  );
}
