/* Stub for the template's missing _shared routing: single page, so routes
   either scroll to a section or jump to a real portal page. */
const ROUTE_TARGETS: Record<string, string> = {
  '': '#hero',
  features: '#features',
  about: '#about',
  pricing: '/domains',
  manifesto: '#face',
  contact: '/student-login.html',
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
