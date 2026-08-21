import { useState } from 'react';
import { Card, Button } from '../ui';

/**
 * Structures, not achievements.
 *
 * Every sample here is headings and shape with the content described rather
 * than written. Copying a stranger's bullet onto your page is the fastest
 * way to fail the interview it wins you, so "Use structure" copies the
 * skeleton and nothing else.
 */
const SAMPLES = [
  {
    name: 'Backend intern',
    who: 'Final-year student, one internship, two projects.',
    skeleton: [
      'NAME',
      'Backend Engineer',
      'email | phone | github.com/you | city',
      '',
      'SUMMARY',
      '<role> with hands-on experience across <the tools your bullets prove>. <Your strongest quantified line.>',
      '',
      'SKILLS',
      '<languages and tools you could defend in an interview>',
      '',
      'EXPERIENCE',
      '<Title>, <Company> | <Mon YYYY> – <Mon YYYY>',
      '- <Verb> <what you built> <with which tool>, <the number it moved>',
      '- <Verb> <what you fixed or automated>, <how much time or how many defects>',
      '',
      'PROJECTS',
      '- <Name> — <what it does>. Built with <stack>. <Who used it, how many>',
      '',
      'EDUCATION',
      '- <Degree>, <Institution>, <YYYY> – <YYYY>',
    ].join('\n'),
  },
  {
    name: 'Data analyst',
    who: 'Switching in from another field, strong project evidence.',
    skeleton: [
      'NAME',
      'Data Analyst',
      'email | phone | linkedin.com/in/you | city',
      '',
      'SUMMARY',
      '<role> working in <SQL, Python, the BI tool you actually use>. <Your strongest measured result.>',
      '',
      'SKILLS',
      '<query languages, statistics, visualisation tools you have shipped with>',
      '',
      'EXPERIENCE',
      '<Title>, <Company> | <Mon YYYY> – <Mon YYYY>',
      '- <Verb> <the analysis>, <the decision it changed>',
      '- <Verb> <the dashboard or model>, <how many people use it>',
      '',
      'PROJECTS',
      '- <Name> — <question it answered>. <Dataset size>. <Method>',
      '',
      'EDUCATION',
      '- <Degree>, <Institution>, <YYYY> – <YYYY>',
    ].join('\n'),
  },
  {
    name: 'Product intern',
    who: 'No formal PM title yet — evidence from clubs, side projects, internships.',
    skeleton: [
      'NAME',
      'Product Manager',
      'email | phone | linkedin.com/in/you | city',
      '',
      'SUMMARY',
      '<role> with experience in <discovery, analytics, whichever you have done>. <The outcome you can prove.>',
      '',
      'SKILLS',
      '<research methods, analytics tools, prototyping tools you have used>',
      '',
      'EXPERIENCE',
      '<Title>, <Company or society> | <Mon YYYY> – <Mon YYYY>',
      '- <Verb> <what you shipped or ran>, <adoption or revenue or retention number>',
      '- <Verb> <the research>, <how many users, what changed as a result>',
      '',
      'PROJECTS',
      '- <Name> — <problem>. <What you launched>. <Users reached>',
      '',
      'EDUCATION',
      '- <Degree>, <Institution>, <YYYY> – <YYYY>',
    ].join('\n'),
  },
];

export default function Library() {
  const [open, setOpen] = useState(SAMPLES[0].name);
  const current = SAMPLES.find((s) => s.name === open) || SAMPLES[0];

  return (
    <div className="space-y-4">
      <Card
        title="Sample structures"
        note="Headings and shape only. The angle brackets are yours to fill — nothing here is a real person's achievement."
      >
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s.name}
              onClick={() => setOpen(s.name)}
              className={[
                'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                s.name === open
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]'
                  : 'border-[var(--line)] text-[var(--mute)] hover:border-[var(--accent)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              {s.name}
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={current.name}
        note={current.who}
        actions={
          <Button kind="ghost" onClick={() => navigator.clipboard?.writeText(current.skeleton)}>
            Use structure
          </Button>
        }
      >
        <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--mute)]">
          {current.skeleton}
        </pre>
      </Card>
    </div>
  );
}
