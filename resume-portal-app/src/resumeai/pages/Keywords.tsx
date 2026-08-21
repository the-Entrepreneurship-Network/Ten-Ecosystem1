import { useState } from 'react';
import { send } from '../api';
import { patchSession, setSession, useSession } from '../store';
import { Busy, Button, Card, Empty, Field, Problem, Reply, inputClass } from '../ui';

/**
 * The posting's words against the page's evidence.
 *
 * Three states, and the middle one is the useful one nobody reports: a skill
 * on the skills line with no bullet behind it is not present, it is a claim
 * waiting to be asked about in a room.
 *
 * Nothing is inserted automatically. A keyword you cannot defend is worse
 * than a missing one, so the table says where each term belongs and leaves
 * the writing to the person who did the work.
 */
export default function Keywords() {
  const session = useSession();
  const [jd, setJd] = useState(String(session.jd || ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [table, setTable] = useState('');
  const [bullets, setBullets] = useState('');
  const [plan, setPlan] = useState('');

  const hasResume = Boolean(String(session.resumeText || '').trim());

  async function run(cmd: string, set: (s: string) => void) {
    if (!jd.trim()) return setErr('Paste the job description first.');
    setBusy(true);
    setErr('');
    patchSession({ jd: jd.trim() });
    const out = await send(cmd, { session: { ...session, jd: jd.trim() } });
    setBusy(false);
    if (!out.ok) return setErr(out.error || 'That did not work.');
    setSession(out.session);
    set(out.reply || '');
  }

  return (
    <div className="space-y-4">
      <Card title="The posting" note="Paste the requirements section — that is where the hard terms live.">
        <Field label="Job description">
          <textarea
            className={`${inputClass} min-h-[140px] resize-y`}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the full job description…"
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => run('missing keywords', setTable)} disabled={busy || !hasResume}>
            Map the keywords
          </Button>
          <Button kind="ghost" onClick={() => run('my most relevant bullets', setBullets)} disabled={busy || !hasResume}>
            My best lines for this
          </Button>
          <Button kind="ghost" onClick={() => run('how do I get these skills', setPlan)} disabled={busy || !hasResume}>
            How do I get what is missing
          </Button>
        </div>
        {!hasResume && (
          <p className="mt-2 text-[11.5px] text-[var(--warn)]">Upload a resume first — there is nothing to match against.</p>
        )}
      </Card>

      {busy && <Busy />}
      {err && <Problem>{err}</Problem>}

      {table && (
        <Card
          title="Present, weak, missing"
          note="Weak means you claimed it and no bullet proves it — the question that ends interviews."
        >
          <Reply text={table} />
        </Card>
      )}

      {bullets && (
        <Card title="Your most relevant lines" note="Ranked by this posting's own terms. Nothing rewritten — your words, reordered.">
          <Reply text={bullets} />
        </Card>
      )}

      {plan && (
        <Card
          title="Closing the gap"
          note="A project for each missing term. None of it goes on the page until you have built it — a project you cannot walk through fails the first question about it."
        >
          <Reply text={plan} />
        </Card>
      )}

      {!table && !bullets && !plan && !busy && (
        <Card>
          <Empty>Paste a posting above and the mapping appears here.</Empty>
        </Card>
      )}
    </div>
  );
}
