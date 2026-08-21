import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { send } from '../api';
import { loadApplications, useSession } from '../store';
import { Busy, Card, Empty, Reply } from '../ui';

/**
 * What is true right now, and the one thing worth doing next.
 *
 * Not a greeting and not a menu — the rail is already the menu. The next
 * action is derived from the state rather than listed as an option, because
 * "you have no resume on file" and "your page is at 96 and needs one number"
 * are different situations with different single next steps.
 */
export default function Dashboard() {
  const session = useSession();
  const apps = loadApplications();
  const [versions, setVersions] = useState<string>('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    send('list my versions', { session }).then((out) => {
      if (!alive) return;
      setVersions(out.reply || '');
      setBusy(false);
    });
    return () => {
      alive = false;
    };
    /* Once on mount: the dashboard reports state, it does not poll it. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasResume = Boolean(String(session.resumeText || '').trim());
  const open = apps.filter((a) => a.status !== 'applied' && a.status !== 'closed').length;

  const next = !hasResume
    ? { text: 'Upload the resume you have, or build one from scratch.', to: '/create', cta: 'Create resume' }
    : !session.jd
      ? { text: 'Paste a job description — keywords are only real against a posting.', to: '/keywords', cta: 'Keyword target' }
      : open === 0
        ? { text: 'Find openings that match what your page can prove.', to: '/hunt', cta: 'Job hunt' }
        : { text: `${open} application${open === 1 ? '' : 's'} open. Tailor the next one.`, to: '/applications', cta: 'Applications' };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Resume">
          <p className="text-[22px] font-semibold tabular-nums">{hasResume ? 'On file' : '—'}</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--mute)]">
            {hasResume ? `${String(session.resumeText).split(/\s+/).filter(Boolean).length} words` : 'Nothing uploaded yet'}
          </p>
        </Card>
        <Card title="Target">
          <p className="truncate text-[22px] font-semibold">{String(session.target || '—')}</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--mute)]">{session.jd ? 'Job description on file' : 'No posting yet'}</p>
        </Card>
        <Card title="Open applications">
          <p className="text-[22px] font-semibold tabular-nums">{open}</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--mute)]">{apps.length} tracked in total</p>
        </Card>
      </div>

      <Card title="Next">
        <p className="text-[13px] leading-relaxed text-[var(--mute)]">{next.text}</p>
        <Link
          to={next.to}
          className="mt-2.5 inline-block rounded-[9px] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[#04120C]"
        >
          {next.cta} →
        </Link>
      </Card>

      <Card title="Your versions" note="Every tailoring is kept beside the master, with the note it shipped with.">
        {busy ? <Busy /> : versions ? <Reply text={versions} /> : <Empty>Nothing saved yet.</Empty>}
      </Card>
    </div>
  );
}
