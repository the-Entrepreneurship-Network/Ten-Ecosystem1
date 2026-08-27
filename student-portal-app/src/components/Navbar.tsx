import type { MouseEvent } from 'react';
import { GraduationCap } from 'lucide-react';
import { navigateToRoute, routeHref } from '../shared';

/* Domains left the bar with the STUDENT pill: a visitor's one path is the
 * email sign-up in the hero, then the mail, then the overview — a nav shortcut
 * around that path just skips the explanation that sells it. */
const NAV_ITEMS = [
  { label: 'Features', route: 'features' },
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
        {/* No Sign Up link: the email box in the hero IS the sign-up. */}
        <div className="flex items-center gap-4">
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
