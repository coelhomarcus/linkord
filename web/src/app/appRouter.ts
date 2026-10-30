import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';

export function createAppRouter(routes: RouteObject[]) {
  return createBrowserRouter(routes);
}
