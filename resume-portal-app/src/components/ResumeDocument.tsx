/**
 * The resume, rendered as a document rather than a text dump.
 *
 * It was a <pre> block: every line in the same monospace grey, so a heading
 * looked exactly like a bullet and the page a student had just been handed
 * read as a wall. A resume has structure — a name, a contact line, headings,
 * dated roles, bullets — and all of it is already in the text; showing it
 * flat throws that away at the last step, in the one place the student
 * actually looks.
 *
 * Nothing is reformatted or reordered. This reads the shape that is there
 * and gives each part the weight it has on paper.
 */

type Line =
  | { kind: 'name'; text: string }
  | { kind: 'title'; text: string }
  | { kind: 'contact'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'role'; text: string; dates: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'blank' };

/* A heading is a short line in capitals, which is how every resume writes
   one and how every parser finds one. */
const HEADING = /^[A-Z][A-Z0-9 &/'()-]{2,34}$/;
const BULLET = /^\s*[-•*·▪]\s+/;
const DATES = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{4})\s*[–—-]\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|present|current|\d{4})/i;
const CONTACT = /@|\+\d|\bgithub\.com|\blinkedin\.com|\b\d{5}/i;

function parse(text: string): Line[] {
  const raw = String(text || '').split('\n');
  const out: Line[] = [];
  let seenHeading = false;

  raw.forEach((r, i) => {
    const line = r.trim();
    if (!line) { out.push({ kind: 'blank' }); return; }

    if (BULLET.test(line)) {
      out.push({ kind: 'bullet', text: line.replace(BULLET, '') });
      return;
    }

    /*
     * The name is the first thing on the page, and it is usually in capitals
     * — which is also exactly what a section heading looks like. Whichever
     * test runs first wins, so the name has to be claimed before the heading
     * test ever sees it, or "BISHAL NAG" ships as a section called BISHAL NAG.
     */
    const isFirstReal = out.every((o) => o.kind === 'blank');
    if (isFirstReal) { out.push({ kind: 'name', text: line }); return; }

    if (HEADING.test(line) && line.split(/\s+/).length <= 5) {
      seenHeading = true;
      out.push({ kind: 'heading', text: line });
      return;
    }

    /* Still above the first heading: the job title, then the contact line.
       Order is what identifies them. */
    if (!seenHeading) {
      if (CONTACT.test(line)) { out.push({ kind: 'contact', text: line }); return; }
      if (i < 5) { out.push({ kind: 'title', text: line }); return; }
    }

    /* A role header carries its dates, and they belong on the right where a
       reader's eye goes for them. */
    const d = line.match(DATES);
    if (d && (line.includes('|') || line.includes(','))) {
      out.push({ kind: 'role', text: line.replace(d[0], '').replace(/[|,]\s*$/, '').trim(), dates: d[0] });
      return;
    }
    if (line.includes('|') && line.split('|').length >= 2 && line.length < 90 && seenHeading) {
      out.push({ kind: 'role', text: line, dates: '' });
      return;
    }

    out.push({ kind: 'text', text: line });
  });

  return out;
}

export function ResumeDocument({ text }: { text: string }) {
  const lines = parse(text);

  return (
    <article
      className="mx-auto max-w-[760px] bg-white px-8 py-8 text-[#111827] shadow-[0_1px_3px_rgba(16,24,40,0.06)]"
      style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}
    >
      {lines.map((l, i) => {
        switch (l.kind) {
          case 'name':
            return (
              <h1 key={i} className="text-[26px] font-bold uppercase leading-tight tracking-[0.04em] text-[#111827]">
                {l.text}
              </h1>
            );
          case 'title':
            return <p key={i} className="mt-0.5 text-[14px] font-medium text-[#374151]">{l.text}</p>;
          case 'contact':
            return <p key={i} className="mt-1 text-[12px] text-[#6b7280]">{l.text}</p>;
          case 'heading':
            return (
              /* The rule under a heading is what separates one section from
                 the next at a glance — the thing a flat dump has no way to
                 show. */
              <h2 key={i} className="mb-2 mt-5 border-b border-[#d1d5db] pb-1 text-[12.5px] font-bold uppercase tracking-[0.12em] text-[#111827]">
                {l.text}
              </h2>
            );
          case 'role':
            return (
              <div key={i} className="mt-2.5 flex items-baseline justify-between gap-4">
                <p className="min-w-0 text-[13px] font-semibold text-[#111827]">{l.text}</p>
                {l.dates && <span className="shrink-0 text-[11.5px] text-[#6b7280]">{l.dates}</span>}
              </div>
            );
          case 'bullet':
            return (
              <div key={i} className="mt-1 flex gap-2 pl-1">
                <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-[#6b7280]" />
                <p className="text-[12.5px] leading-[1.55] text-[#374151]">{l.text}</p>
              </div>
            );
          case 'text':
            return <p key={i} className="mt-1 text-[12.5px] leading-[1.55] text-[#374151]">{l.text}</p>;
          default:
            return <div key={i} className="h-1.5" />;
        }
      })}
    </article>
  );
}
