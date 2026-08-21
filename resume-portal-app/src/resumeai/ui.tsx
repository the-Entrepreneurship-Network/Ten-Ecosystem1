import { useState, type ReactNode } from 'react';
import type { Check, Options, Report } from './api';

/* The handful of pieces every page needs, in one file so that a change to
   the look happens once rather than nine times. */

export function Card({ title, note, children, actions }: {
  title?: string; note?: string; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold">{title}</h2>}
            {note && <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--mute)]">{note}</p>}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ children, onClick, kind = 'primary', disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost'; disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const base = 'rounded-[9px] px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-45';
  const look = kind === 'primary'
    ? 'bg-[var(--accent)] text-[#04120C] hover:brightness-110'
    : 'border border-[var(--line)] text-[var(--mute)] hover:border-[var(--accent)] hover:text-[var(--text)]';
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-[var(--mute)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-[var(--mute)]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-[9px] border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--mute)] focus:border-[var(--accent)]';

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-[12.5px] leading-relaxed text-[var(--mute)]">{children}</p>;
}

export function Busy({ children = 'Working…' }: { children?: ReactNode }) {
  return <p className="py-6 text-center text-[12.5px] text-[var(--mute)]">{children}</p>;
}

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-[12.5px] text-[var(--danger)]">
      {children}
    </p>
  );
}

/** A 0–100 bar. `null` means the thing was never measured, which is not zero. */
export function Bar({ label, value, note }: { label: string; value: number | null; note?: string }) {
  const tone = value === null ? 'var(--mute)'
    : value >= 80 ? 'var(--accent)' : value >= 55 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-[var(--text)]">{label}</span>
        <span className="text-[11.5px] tabular-nums text-[var(--mute)]">
          {value === null ? 'not measured' : `${value}/100`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--raised)]">
        <div
          className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${value ?? 0}%`, background: tone }}
        />
      </div>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-[var(--mute)]">{note}</p>}
    </div>
  );
}

/** The checker's own rows — every check, what it cost, and the fix. */
export function Checks({ report }: { report: Report }) {
  const rows: Check[] = report.checks || [];
  return (
    <div className="space-y-2.5">
      {rows.map((c) => {
        const full = c.earned >= c.weight;
        return (
          <div key={c.id} className="flex gap-2.5">
            <span className={`mt-0.5 text-[12px] ${full ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>
              {full ? '✓' : '✗'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px]">
                {c.label}{' '}
                <span className="tabular-nums text-[var(--mute)]">
                  {Math.round(c.earned)}/{c.weight}
                </span>
              </p>
              <p className="text-[11.5px] leading-relaxed text-[var(--mute)]">{c.detail}</p>
              {!full && c.fix && <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--warn)]">{c.fix}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The agent's reply, rendered.
 *
 * It writes markdown tables and the occasional bold line, and printing the
 * pipes raw is how a table becomes noise.
 */
export function Reply({ text }: { text: string }) {
  const lines = String(text || '').split('\n');
  const blocks: { kind: 'text' | 'table'; lines: string[] }[] = [];
  const isRow = (l: string) => l.trim().startsWith('|') && l.trim().endsWith('|');

  lines.forEach((l) => {
    const kind = isRow(l) ? 'table' : 'text';
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.lines.push(l);
    else blocks.push({ kind, lines: [l] });
  });

  const cells = (l: string) => l.trim().slice(1, -1).split('|').map((c) => c.trim());
  const bold = (s: string) =>
    s.split(/\*\*([^*]+)\*\*/).map((part, i) => (i % 2 ? <b key={i} className="text-[var(--text)]">{part}</b> : part));

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.kind === 'table') {
          const rows = b.lines.filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim()));
          if (!rows.length) return null;
          const [head, ...body] = rows;
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr>
                    {cells(head).map((c, n) => (
                      <th key={n} className="border-b border-[var(--line)] px-2 py-1.5 text-left font-medium text-[var(--mute)]">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, n) => (
                    <tr key={n}>
                      {cells(r).map((c, m) => (
                        <td key={m} className="border-b border-[var(--line)] px-2 py-1.5 align-top text-[var(--text)]">
                          {bold(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const body = b.lines.join('\n').trim();
        if (!body) return null;
        return (
          <p key={i} className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--mute)]">
            {bold(body)}
          </p>
        );
      })}
    </div>
  );
}

/** The agent's own answer set for a question, as chips. */
export function Choices({ options, onPick, disabled }: {
  options: Options; onPick: (v: string) => void; disabled?: boolean;
}) {
  const [multi, setMulti] = useState<string[]>([]);
  const flat = options.groups
    ? options.groups.flatMap((g) => g.options.map((o) => ({ ...o, group: g.group })))
    : (options.options || []).map((o) => ({ ...o, group: '' }));
  if (!flat.length) return null;

  const groups = [...new Set(flat.map((o) => o.group))];

  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g}>
          {g && <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--mute)]">{g}</p>}
          <div className="flex flex-wrap gap-1.5">
            {flat.filter((o) => o.group === g).map((o) => {
              const on = multi.includes(o.value);
              return (
                <button
                  key={o.value + o.label}
                  disabled={disabled}
                  onClick={() => {
                    if (!options.multi) return onPick(o.value);
                    setMulti((m) => (on ? m.filter((x) => x !== o.value) : [...m, o.value]));
                  }}
                  className={[
                    'rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors disabled:opacity-45',
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]'
                      : 'border-[var(--line)] text-[var(--mute)] hover:border-[var(--accent)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  {o.label}
                  {o.note && <span className="ml-1.5 text-[10.5px] text-[var(--mute)]">· {o.note}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {options.multi && (
        <Button onClick={() => onPick(multi.join(', '))} disabled={disabled || !multi.length}>
          Use {multi.length || 'these'}
        </Button>
      )}
      {options.other && (
        <p className="text-[11.5px] text-[var(--mute)]">{options.other.label} — type it below.</p>
      )}
    </div>
  );
}
