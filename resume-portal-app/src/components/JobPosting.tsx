/**
 * A job advert, laid out the way a person reads one.
 *
 * The posting arrives as lines: some are section headings ("Responsibilities",
 * "Requirements", "About the Role"), some are bullets, the rest is prose. Shown
 * as one block it is a wall, and deciding whether to tailor for a job means
 * actually reading it — so the headings get to be headings.
 */

type Job = {
  title: string;
  company: string;
  location?: string;
  url: string;
  description?: string;
  tags?: string[];
};

/* The headings adverts actually use. Matched as whole short lines so a
   sentence mentioning "requirements" is not mistaken for a section. */
const SECTION = /^(about( the| this)? (role|job|position|team|us|company)|the role|role overview|overview|responsibilities|what you.{0,3}ll do|key responsibilities|duties|requirements|qualifications|what we.{0,3}re looking for|must have|nice to have|skills|experience|preferred|benefits|perks|what we offer|compensation|salary|about you|who you are)\b[:\s]*$/i;

const BULLET = /^\s*[•\-*·▪]\s+/;

export function JobPosting({ job, onTailor, busy }: {
  job: Job; onTailor: () => void; busy?: boolean;
}) {
  const lines = String(job.description || '').split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <div className="mx-auto max-w-[760px] overflow-hidden rounded-xl border border-[#e5e9f0] bg-white">
      {/* The action sits with the title, top right, where a decision about a
          posting belongs. */}
      <div className="flex items-start justify-between gap-4 border-b border-[#eef1f6] px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold leading-tight text-[#111827]">{job.title}</h2>
          <p className="mt-1 text-[13px] text-[#374151]">{job.company}</p>
          {job.location && <p className="mt-0.5 text-[12.5px] text-[#6b7280]">{job.location}</p>}
        </div>
        <button
          onClick={onTailor}
          disabled={busy}
          className="shrink-0 rounded-lg bg-[#2563eb] px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50"
        >
          Tailor resume
        </button>
      </div>

      <div className="px-6 py-5">
        {job.tags && job.tags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {job.tags.slice(0, 10).map((t) => (
              <span key={t} className="rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[11px] text-[#374151]">{t}</span>
            ))}
          </div>
        )}

        {lines.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-[#9ca3af]">
            This board did not publish the full description. The title, the employer and the tags above are
            everything it gave — tailoring will work from those.
          </p>
        )}

        {lines.map((l, i) => {
          if (SECTION.test(l)) {
            return (
              <h3 key={i} className="mb-2 mt-5 text-[15px] font-bold text-[#111827] first:mt-0">
                {l.replace(/[:\s]*$/, '')}
              </h3>
            );
          }
          if (BULLET.test(l)) {
            return (
              <div key={i} className="mb-1.5 flex gap-2.5">
                <span className="mt-[8px] h-[4px] w-[4px] shrink-0 rounded-full bg-[#6b7280]" />
                <p className="text-[13px] leading-[1.6] text-[#374151]">{l.replace(BULLET, '')}</p>
              </div>
            );
          }
          return <p key={i} className="mb-2 text-[13px] leading-[1.6] text-[#374151]">{l}</p>;
        })}
      </div>
    </div>
  );
}
