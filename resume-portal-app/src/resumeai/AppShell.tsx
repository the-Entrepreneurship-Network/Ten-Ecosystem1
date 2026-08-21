import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from './store';

/**
 * The rail is the product.
 *
 * Ten places, named for what a student is trying to do rather than for the
 * machinery behind them. AI Interview is deliberately absent: scoring how
 * somebody sounded needs audio this app does not have, and a gauge derived
 * from a transcript is a guess wearing a number.
 */
const NAV: { to: string; label: string; icon: string }[] = [
  { to: '/create', label: 'Create resume', icon: '✎' },
  { to: '/', label: 'My dashboard', icon: '◧' },
  { to: '/agent', label: 'Resume agent', icon: '✦' },
  { to: '/review', label: 'Review / score', icon: '▤' },
  { to: '/keywords', label: 'Keyword target', icon: '⌘' },
  { to: '/cover', label: 'Cover letter', icon: '✉' },
  { to: '/hunt', label: 'Job hunt', icon: '⌕' },
  { to: '/applications', label: 'Applications', icon: '⧉' },
  { to: '/library', label: 'Sample library', icon: '≡' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function AppShell() {
  const session = useSession();
  const loc = useLocation();
  const here = NAV.find((n) => n.to === loc.pathname);
  /* A resume on file is the difference between every page working and most
     of them asking for one, so the state is shown rather than discovered. */
  const hasResume = Boolean(String(session.resumeText || '').trim());

  return (
    <div className="flex min-h-screen bg-[var(--canvas)] text-[var(--text)]">
      <aside className="fixed inset-y-0 left-0 hidden w-[240px] flex-col border-r border-[var(--line)] bg-[var(--surface)] md:flex">
        <div className="flex h-[56px] items-center gap-2.5 border-b border-[var(--line)] px-4">
          <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[var(--accent)] text-[13px] font-bold text-[#04120C]">
            R
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight">Resume AI</p>
            <p className="truncate text-[10.5px] leading-tight text-[var(--mute)]">TEN Career Studio</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                [
                  'mb-0.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors',
                  isActive
                    ? 'bg-[var(--raised)] text-[var(--text)]'
                    : 'text-[var(--mute)] hover:bg-white/[0.04] hover:text-[var(--text)]',
                ].join(' ')
              }
            >
              <span className="w-4 text-center text-[13px]">{n.icon}</span>
              <span className="truncate">{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[var(--line)] p-3">
          <div className="rounded-[10px] bg-[var(--raised)] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--mute)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${hasResume ? 'bg-[var(--accent)]' : 'bg-[var(--warn)]'}`}
              />
              {hasResume ? 'Resume on file' : 'No resume yet'}
            </p>
            {!hasResume && (
              <NavLink to="/create" className="mt-1 block text-[11.5px] text-[var(--accent)] hover:underline">
                Upload or build one →
              </NavLink>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-[240px]">
        <header className="sticky top-0 z-10 flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--canvas)]/95 px-4 backdrop-blur">
          <h1 className="truncate text-[14px] font-semibold">{here?.label ?? 'Resume AI'}</h1>
          <a
            href="/resume-portal/"
            className="rounded-[9px] border border-[var(--line)] px-3 py-1.5 text-[11.5px] text-[var(--mute)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          >
            ← Resume portal
          </a>
        </header>

        {/* The rail collapses on a phone rather than disappearing: a nav you
            cannot reach is worse than one that scrolls sideways. */}
        <nav className="flex gap-1.5 overflow-x-auto border-b border-[var(--line)] px-3 py-2 md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                [
                  'shrink-0 rounded-full px-3 py-1.5 text-[12px] transition-colors',
                  isActive ? 'bg-[var(--raised)] text-[var(--text)]' : 'text-[var(--mute)]',
                ].join(' ')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
