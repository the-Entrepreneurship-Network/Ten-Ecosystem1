import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { send, type Report } from '../api';
import { setSession, useSession } from '../store';
import { Busy, Button, Card, Checks, Empty, Problem, Reply } from '../ui';

/**
 * The score, and the three views behind it.
 *
 * One number tells somebody they are at 80 and nothing about what to do. The
 * five bars split it the way the work splits; the parser view is the only
 * screen here that is a fact rather than an opinion; and Raise spends every
 * honest lever and then names the fact it cannot supply itself.
 */
export default function Review() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [bars, setBars] = useState('');
  const [parser, setParser] = useState('');
  const [quick, setQuick] = useState('');
  const [raised, setRaised] = useState('');

  const hasResume = Boolean(String(session.resumeText || '').trim());

  async function run(cmd: string, set: (s: string) => void) {
    setBusy(true);
    setErr('');
    const out = await send(cmd, { session });
    setBusy(false);
    if (!out.ok) return setErr(out.error || 'That did not work.');
    setSession(out.session);
    if (out.report) setReport(out.report);
    set(out.reply || out.text || '');
  }

  useEffect(() => {
    if (!hasResume) return;
    run('score breakdown', setBars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasResume) {
    return (
      <Card title="Nothing to score yet">
        <Empty>
          Upload a resume or build one first — then this page shows the five bars, what a parser extracts, and the
          fastest way up.
        </Empty>
        <Link to="/create" className="text-[12.5px] text-[var(--accent)] hover:underline">
          Create resume →
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run('score breakdown', setBars)} disabled={busy}>
          Score
        </Button>
        <Button kind="ghost" onClick={() => run('quick check', setQuick)} disabled={busy}>
          Ten-second check
        </Button>
        <Button kind="ghost" onClick={() => run('what does the ats see', setParser)} disabled={busy}>
          What the ATS extracts
        </Button>
        <Button kind="ghost" onClick={() => run('make it 98', setRaised)} disabled={busy}>
          Raise the score
        </Button>
      </div>

      {busy && <Busy />}
      {err && <Problem>{err}</Problem>}

      <div className="grid gap-4 lg:grid-cols-2">
        {bars && (
          <Card title="Score breakdown" note="Content and Application ready are yours to supply; Format is ours to fix.">
            <Reply text={bars} />
          </Card>
        )}
        {report && (
          <Card title={`Every check · ${report.score}/100`} note="Weighted the way a parser weighs them.">
            <Checks report={report} />
          </Card>
        )}
        {quick && (
          <Card title="Ten-second check" note="What a tired recruiter would notice first.">
            <Reply text={quick} />
          </Card>
        )}
        {parser && (
          <Card
            title="What a parser extracts"
            note="The only view here that is a fact rather than an opinion."
          >
            <Reply text={parser} />
          </Card>
        )}
        {raised && (
          <Card title="Raise" note="Every honest lever spent. Where it stops, it says which fact is missing.">
            <Reply text={raised} />
          </Card>
        )}
      </div>
    </div>
  );
}
