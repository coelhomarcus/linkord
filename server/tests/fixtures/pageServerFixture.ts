import http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';

// The real lookup refuses loopback (SSRF guard); only tests reach a local page server.
export const allowLoopback: LookupFunction = (_host, options, callback) => {
  if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
  callback(null, '127.0.0.1', 4);
};

export type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/** A local server answering each path with its route (404 otherwise), and
 * the base URL to reach it through `allowLoopback`. */
export async function startPageServer(routes: Record<string, Route>): Promise<{ base: string; hits: Map<string, number>; close: () => void }> {
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const route = routes[path];
    if (route) return route(req, res);
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://localhost:${(server.address() as AddressInfo).port}`,
    hits,
    close: () => { server.close(); server.closeAllConnections(); },
  };
}

export function html(body: string | Buffer, contentType = 'text/html'): Route {
  return (_req, res) => { res.setHeader('content-type', contentType); res.end(body); };
}

export function typed(contentType: string, body: string | Buffer = ''): Route {
  return (_req, res) => { res.setHeader('content-type', contentType); res.end(body); };
}
