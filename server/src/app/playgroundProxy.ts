import net from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Logger } from '../lib/logger.js';

// With the playground service in this container (PLAYGROUND_EMBEDDED=1), the
// browsers' game connection (a websocket on /playground/ws) is handed to it
// from here, so the app's own port is all the proxy in front needs to route:
// a deploy that forgot the extra /playground route on port 3100 (or a proxy
// that cannot have one) still reaches the game. A route that does send
// /playground/ straight to the service keeps working; it just never gets here.

const PLAYGROUND_PREFIX = '/playground/';
/** waiting for the service to accept the connection longer than this, the browser is told it is not there */
const CONNECT_TIMEOUT_MS = 5000;

/** Whether an upgrade request is the playground's. */
export function isPlaygroundUpgrade(url: string | undefined): boolean {
  return !!url && url.startsWith(PLAYGROUND_PREFIX);
}

/** The request as it arrived, line and headers, to replay to the service. */
function requestHead(req: IncomingMessage): string {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** Passes the websocket upgrades under /playground/ on to the service listening on `port` here. */
export function proxyPlaygroundUpgrades(server: Server, port: number, log: Pick<Logger, 'warn'>): void {
  server.on('upgrade', (req: IncomingMessage, client: Duplex, head: Buffer) => {
    if (!isPlaygroundUpgrade(req.url)) return;
    const upstream = net.connect({ host: '127.0.0.1', port });
    upstream.setTimeout(CONNECT_TIMEOUT_MS);
    const fail = () => {
      if (client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      upstream.destroy();
    };
    upstream.once('timeout', () => {
      log.warn('the playground service did not answer in time');
      fail();
    });
    upstream.once('connect', () => {
      upstream.setTimeout(0);
      upstream.write(requestHead(req));
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once('error', (err) => {
      log.warn('could not reach the playground service', { reason: err.message });
      fail();
    });
    client.once('error', () => upstream.destroy());
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
  });
}
