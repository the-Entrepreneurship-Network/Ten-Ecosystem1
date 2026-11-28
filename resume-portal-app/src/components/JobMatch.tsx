import { useEffect, useState } from 'react';

/**
 * The resume against one job description, the way Jobscan shows it: how much
 * of the posting's vocabulary the resume has, what is missing, and where each
 * missing word would go — if it is true. Read by POST /api/v2/resume/match,
 * which is rules only, so it is instant and costs nothing.
 */
type Missing = { term: string; where: string; tip: string };
type Report = { percent: number; passes: boolean; matched: string[]; missing: Missing[] };

export function JobMatch({ resume, jd, title }: { resume: string; jd: string; title?: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null); setError('');
    if (!resume.trim() || (jd.trim().length < 40 && !title)) return;
    let live = true;
    fetch('/api/v2/resume/match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: resume, jd, title }),
    })
      .then((r) => r.json())
      .then((d) => { if (live) { if (d.ok) setReport(d); else setError(d.error || 'Could not check the match.'); } })
      .catch(() => { if (live) setError('Could not check the match just now.'); });
    return () => { live = false; };
  }, [resume, jd, title]);

  if (!resume.trim()) {
    return (
      <p className="rounded-xl border border-[#e5e9f0] bg-white px-5 py-4 text-[12.5px] text-[#6b7280]">
        Attach your resume in the chat, and your match with this job shows here.
      </p>
    );
  }
  if (error) return <p className="rounded-xl border border-[#fde2e2] bg-[#fff7f7] px-5 py-4 text-[12.5px] text-[#b42318]">{error}</p>;
  if (!report) return null;

  const groups = report.missing.reduce<Record<string, Missing[]>>((acc, m) => {
    (acc[m.where] = acc[m.where] || []).push(m);
    return acc;
  }, {});

  return (
    <div className="rounded-xl border border-[#e5e9f0] bg-white px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-[#111827]">Your match with this job</p>
        <p className={`text-[22px] font-bold ${report.passes ? 'text-[#059669]' : report.percent >= 50 ? 'text-[#d97706]' : 'text-[#dc2626]'}`}>
          {report.percent}%
        </p>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-[#6b7280]">
        Share of the posting's keywords your resume already has. Most applicant filters pass around 70%.
        Short forms count: JS is JavaScript.
      </p>

      {report.matched.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {report.matched.map((t) => (
            <span key={t} className="rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[11px] text-[#047857]">✓ {t}</span>
          ))}
        </div>
      )}

      {report.missing.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-[12px] font-semibold text-[#111827]">Missing, and where each would go — only if it is true</p>
          {Object.entries(groups).map(([where, items]) => (
            <div key={where}>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[#6b7280]">{where}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {items.map((m) => (
                  <span key={m.term} className="rounded-full bg-[#fff7ed] px-2.5 py-1 text-[11px] text-[#9a3412]">{m.term}</span>
                ))}
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[#6b7280]">{items[0].tip}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
