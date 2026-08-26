import type { MouseEvent } from 'react';
import { GraduationCap } from 'lucide-react';
import { navigateToRoute, routeHref } from '../shared';

const NAV_ITEMS = [
  { label: 'Features', route: 'features' },
  { label: 'Domains', route: 'pricing' },
  { label: 'About', route: 'about' },
] as const;

export default function Navbar() {
  const navClick = (route: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    navigateToRoute(route);
  };

  return (
    <nav className="relative z-20 px-6 py-6">
      <div className="liquid-glass mx-auto flex max-w-5xl items-center justify-between rounded-full px-6 py-3">
        <div className="flex items-center gap-8">
          <a
            href={routeHref('')}
            onClick={navClick('')}
            className="flex items-center gap-2 text-lg font-semibold text-white"
            aria-label="TEN Career Studio home"
          >
            <GraduationCap className="h-6 w-6" aria-hidden />
            TEN Career Studio
          </a>
          {/* STUDENT alone.
              JOB, RESUME and HACK used to sit here as links straight into the
              portals — which is now a door into a paywall: middleware/studioGate.js
              turns those URLs away, so the pills led a visitor to a bounce. The
              four products are reached from the ecosystem ring further down the
              page, which routes through the pay screen the way it is meant to. */}
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black">
              STUDENT
            </span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            {NAV_ITEMS.map((link) => (
              <a
                key={link.route}
                href={routeHref(link.route)}
                onClick={navClick(link.route)}
                className="text-sm font-medium text-white/80 transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="/register.html"
            className="text-sm font-medium text-white transition-colors hover:text-white/90"
          >
            Sign Up
          </a>
          <a
            href="/student-login.html"
            className="liquid-glass rounded-full px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-white/5"
          >
            Login
          </a>
        </div>
      </div>
    </nav>
  );
}
