/* Single page: routes either scroll to a section or jump to a real portal page. */
const ROUTE_TARGETS: Record<string, string> = {
  student: '/student-portal/',
  job: '/job-portal/',
  resume: '#home',
  dashboard: '/resume-dashboard.html',
  build: '/resume-dashboard.html',
};

export function routeHref(route: string): string {
  return ROUTE_TARGETS[route] ?? '#';
}

export function navigateToRoute(route: string): void {
  const target = routeHref(route);
  if (target.startsWith('#')) {
    document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
  } else {
    window.location.href = target;
  }
}
