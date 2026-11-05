import { createBrowserRouter, createPath } from 'react-router';
import type { RouteObject, To } from 'react-router';

/** What the address bar shows while you are anywhere in the app. */
const APP_ADDRESS = '/app';

/** The address bar's text for a page: its own path for the pages meant to be
 * opened from a link or shared (settings and administration, an invite),
 * the bare app address for everything else — no server, channel or
 * conversation ids on screen. */
export function addressFor(pathname: string): string {
  if (pathname === '/app/settings' || pathname.startsWith('/app/settings/')) return pathname;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return pathname;
  if (pathname.startsWith('/invite/')) return pathname;
  if (pathname === APP_ADDRESS || pathname.startsWith(`${APP_ADDRESS}/`)) return APP_ADDRESS;
  return pathname;
}

// a relative target ('?tab=…', a hash) resolves against where the app is now
function targetPathname(to: To, current: string): string {
  const href = typeof to === 'string' ? to : createPath(to);
  return new URL(href || current, `http://app${current}`).pathname;
}

type Router = ReturnType<typeof createBrowserRouter>;

/** The browser router, with the real place in the app kept out of the
 * address bar. React Router's location masking writes the real path to
 * history.state and the address shown to the URL, so every page still has
 * its own history entry: back and forward walk the conversations as before,
 * and a refresh reopens the same one. Routes and components keep working
 * with the real paths; only the visible URL changes. */
export function createAppRouter(routes: RouteObject[]): Router {
  const router = createBrowserRouter(routes);
  const navigate = router.navigate.bind(router);
  router.navigate = ((to: To | number | null, opts?: Parameters<Router['navigate']>[1]) => {
    // stepping through history: each entry already carries its own address
    if (typeof to === 'number' || to === null) return navigate(to as number);
    if (opts?.mask) return navigate(to, opts);
    const pathname = targetPathname(to, router.state.location.pathname);
    const address = addressFor(pathname);
    return navigate(to, address === pathname ? opts : { ...opts, mask: address });
  }) as Router['navigate'];

  // A direct visit (an old link with ids, a push notification opening a new
  // window) arrives with the real path in the URL: hide it at once, in place.
  const { location } = router.state;
  if (!location.mask && addressFor(location.pathname) !== location.pathname) {
    void router.navigate(createPath(location), { replace: true, state: location.state });
  }
  return router;
}
