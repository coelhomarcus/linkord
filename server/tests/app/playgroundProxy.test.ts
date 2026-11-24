import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { isPlaygroundUpgrade, proxyPlaygroundUpgrades } from '../../src/app/playgroundProxy.js';

const silent = { warn: () => {} };
const servers: http.Server[] = [];
after(() => { for (const server of servers) server.close(); });

async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** Sends an upgrade request and returns the first chunk the other end answers with. */
function upgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    });
    socket.once('data', (data) => { resolve(data.toString()); socket.destroy(); });
    socket.once('error', reject);
  });
}

describe('proxyPlaygroundUpgrades', () => {
  it('knows the playground\'s paths only', () => {
    assert.equal(isPlaygroundUpgrade('/playground/ws/?EIO=4&transport=websocket'), true);
    assert.equal(isPlaygroundUpgrade('/ws/?EIO=4'), false);
    assert.equal(isPlaygroundUpgrade(undefined), false);
  });

  it('hands a websocket under /playground/ to the service, the request as it came', async () => {
    const service = http.createServer();
    service.on('upgrade', (req, socket) => {
      socket.end(`HTTP/1.1 101 Switching Protocols\r\nX-Seen: ${req.url}\r\n\r\n`);
    });
    const servicePort = await listen(service);
    const app = http.createServer();
    proxyPlaygroundUpgrades(app, servicePort, silent);
    const appPort = await listen(app);
    const answer = await upgrade(appPort, '/playground/ws/?EIO=4&transport=websocket');
    assert.match(answer, /^HTTP\/1\.1 101/);
    assert.match(answer, /X-Seen: \/playground\/ws\/\?EIO=4&transport=websocket/);
  });

  it('says 502 when the service is not there', async () => {
    const closed = http.createServer();
    const deadPort = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const app = http.createServer();
    proxyPlaygroundUpgrades(app, deadPort, silent);
    const appPort = await listen(app);
    assert.match(await upgrade(appPort, '/playground/ws/'), /^HTTP\/1\.1 502/);
  });
});
