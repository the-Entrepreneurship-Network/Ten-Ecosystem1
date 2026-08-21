import { useState } from 'react';
import { send, type Options } from '../api';
import { setSession, useSession } from '../store';
import { Busy, Button, Card, Choices, Empty, Problem, Reply, inputClass } from '../ui';

/**
 * The letter, and the terms a manager reads before the prose.
 *
 * The interview behind this asks what nobody was ever asked: hours a week,
 * which months, how long they can commit, what pay they want. A term nobody
 * states simply does not appear in the letter — the alternative is a
 * paragraph of pleasant defaults that were never true.
 */
export default function Cover() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState<{ text: string; options?: Options } | null>(null);
  const [answer, setAnswer] = useState('');
  const [letter, setLetter] = useState('');

  const hasResume = Boolean(String(session.resumeText || '').trim());

  async function run(message: string) {
    setBusy(true);
    setErr('');
    const out = await send(message, { session });
    setBusy(false);
    if (!out.ok) return setErr(out.error || 'That did not work.');
    setSession(out.session);
    setAnswer('');
    if (out.kind === 'ask') return setAsk({ text: out.reply || '', options: out.options });
    setAsk(null);
    setLetter(out.text || out.reply || '');
  }

  function download() {
    const blob = new Blob([letter], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cover-letter.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card
        title="Cover letter"
        note="Built from your ledger and one posting. Facts only — nothing about you is invented to fill a paragraph."
      >
        <Button onClick={() => run('cover letter')} disabled={busy || !hasResume}>
          {letter ? 'Start again' : 'Write the letter'}
        </Button>
        {!hasResume && (
          <p className="mt-2 text-[11.5px] text-[var(--warn)]">
            A letter is written from a finished resume. Create one first.
          </p>
        )}
      </Card>

      {busy && <Busy />}
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

      {letter && (
        <Card
          title="Your letter"
          actions={
            <>
              <Button kind="ghost" onClick={() => navigator.clipboard?.writeText(letter)}>
                Copy
              </Button>
              <Button kind="ghost" onClick={download}>
                Download .txt
              </Button>
            </>
          }
        >
          <pre className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--mute)]">{letter}</pre>
        </Card>
      )}

      {!letter && !ask && !busy && (
        <Card>
          <Empty>The letter appears here once the questions are answered.</Empty>
        </Card>
      )}
    </div>
  );
}
