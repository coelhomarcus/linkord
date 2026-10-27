import { createMemoryRouter } from 'react-router';
import type { RouteObject } from 'react-router';

import { ROUTES } from '@/shared/lib/routes';

/** The app lives at one address and never writes its pages into the address
 * bar: where you are (a conversation, the friends page, settings) is state,
 * kept by an in-memory router. Links, navigate() and the unsaved-changes guard
 * work exactly as with a browser router; only the URL stays put. */
export function createAppRouter(routes: RouteObject[]) {
  const initial = initialEntry();
  normalizeBrowserUrl();
  return createMemoryRouter(routes, { initialEntries: [initial] });
}

/** Where a visit starts: an old link or bookmark (/app/friends, /app/settings/av)
 * still lands on the page it names, once; anything else starts at the
 * conversations. */
export function initialEntry(): string {
  const { pathname, search } = window.location;
  const known = pathname.startsWith('/app/') || pathname === '/app' || pathname === '/admin' || pathname.startsWith('/admin/');
  return known ? `${pathname}${search}` : ROUTES.conversations;
}

/** Puts the address bar back on the bare address, so the app is only ever
 * reached at its one URL, whatever link brought you here. */
export function normalizeBrowserUrl(): void {
  const { pathname, search, hash } = window.location;
  if (pathname === '/' && !search && !hash) return;
  window.history.replaceState(null, '', '/');
}
