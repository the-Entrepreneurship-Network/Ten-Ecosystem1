import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { send, type Options, type Report } from '../api';
import { setSession, useSession } from '../store';
import { Busy, Button, Card, Choices, Empty, Field, Problem, Reply, inputClass } from '../ui';

/**
 * Two ways in: the file they already have, or the interview.
 *
 * Neither path invents anything. Upload extracts and scores what is there;
 * the interview asks for facts one at a time and leaves out whatever nobody
 * answers, which is why a skipped question produces a shorter page rather
 * than a plausible sentence.
 */
export default function Create() {
  const session = useSession();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState<{ text: string; options?: Options } | null>(null);
  const [answer, setAnswer] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [built, setBuilt] = useState('');

  async function run(message: string, file?: File) {
    setBusy(true);
    setErr('');
    const out = await send(message, { file, session });
    setBusy(false);
    if (!out.ok) return setErr(out.error || 'That did not work.');
    setSession(out.session);
    setAnswer('');

    if (out.kind === 'ask') return setAsk({ text: out.reply || '', options: out.options });
    setAsk(null);
    if (out.report) setReport(out.report);
    if (out.text) setBuilt(out.text);
  }

  const preview = built || String(session.resumeText || '');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-4">
        <Card
          title="Start from a file"
          note="PDF or DOCX. It is read the way a parser reads it, so what you see here is what an ATS gets."
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              Upload a resume
            </Button>
            <Button kind="ghost" onClick={() => nav('/review')} disabled={!session.resumeText}>
              Score what I have
            </Button>
          </div>
        </Card>

        <Card
          title="Or build it from scratch"
          note="One question at a time — target, work, projects, skills, education, availability. Skip any of them."
        >
          <Button onClick={() => run('build a resume from scratch')} disabled={busy}>
            Start the interview
          </Button>
        </Card>

        {busy && <Busy>Reading and scoring…</Busy>}
        {err && <Problem>{err}</Problem>}

        {ask && (
          <Card title="One question">
            <Reply text={ask.text} />
            {ask.options && (
              <div className="mt-3">
                <Choices options={ask.options} disabled={busy} onPick={(v) => run(v)} />
              </div>
            )}
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (answer.trim()) run(answer.trim());
              }}
            >
              <input
                className={inputClass}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer, or say skip"
                autoFocus
              />
              <Button type="submit" disabled={busy || !answer.trim()}>
                Send
              </Button>
            </form>
          </Card>
        )}

        {report && (
          <Card title={`Resume AI score: ${report.score}/100`} note="This rubric, not a live ATS decision.">
            <Button kind="ghost" onClick={() => nav('/review')}>
              See the full breakdown →
            </Button>
          </Card>
        )}
      </div>

      <Card
        title="Preview"
        note="Single column, standard headings — the shape a parser reads."
        actions={
          preview ? (
            <Button kind="ghost" onClick={() => navigator.clipboard?.writeText(preview)}>
              Copy
            </Button>
          ) : undefined
        }
      >
        {preview ? (
          <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--mute)]">
            {preview}
          </pre>
        ) : (
          <Empty>Your resume appears here as soon as one is uploaded or written.</Empty>
        )}
      </Card>
    </div>
  );
}
