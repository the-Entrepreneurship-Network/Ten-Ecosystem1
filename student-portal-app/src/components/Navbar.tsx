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
            aria-label="TEN Student Portal home"
          >
            <GraduationCap className="h-6 w-6" aria-hidden />
            TEN Student Portal
          </a>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black">
              STUDENT
            </span>
            <a
              href="/job-portal/"
              className="rounded-full border border-white/50 px-4 py-1.5 text-xs font-medium text-white transition-all hover:border-white hover:bg-white/10"
            >
              JOB
            </a>
            <a
              href="/resume-portal/"
              className="rounded-full border border-white/50 px-4 py-1.5 text-xs font-medium text-white transition-all hover:border-white hover:bg-white/10"
            >
              RESUME
            </a>
            <a
              href="/hackathon-portal/"
              className="rounded-full border border-white/50 px-4 py-1.5 text-xs font-medium text-white transition-all hover:border-white hover:bg-white/10"
            >
              HACK
            </a>
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
