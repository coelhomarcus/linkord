import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { pool } from '../../../src/db/client.js';
import { backfillEmbeds, unfurlMessage } from '../../../src/modules/messages/messageEmbeds.js';
import { announceRevocations } from '../../../src/modules/servers/serverInvitationsRepository.js';

// These run fire-and-forget after a message or a revocation, and an unhandled rejection ends the
// process. The unit suite's DATABASE_URL reaches no usable database, which stands in for an outage.

// the real lookup refuses loopback (SSRF guard); only this test reaches the local page server
const allowLoopback: LookupFunction = (_host, options, callback) => {
  if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
  callback(null, '127.0.0.1', 4);
};

let server: http.Server;
let base: string;
before(async () => {
  server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<html><head><title>A page</title></head></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  server.closeAllConnections();
  await pool.end();
});

describe('background work that must not reject when the database fails', () => {
  it('unfurlMessage and backfillEmbeds resolve when the preview cannot be stored', async () => {
    const message = { id: 1, conversationId: '00000000-0000-0000-0000-000000000001', text: `look ${base}/page-a` };
    await assert.doesNotReject(unfurlMessage(message, 'embeds-user-a', allowLoopback));
    await assert.doesNotReject(backfillEmbeds([{ ...message, id: 2, text: `look ${base}/page-b` }], 'embeds-user-b', allowLoopback));
  });

  it('announceRevocations resolves when the invitations cannot be read', async () => {
    await assert.doesNotReject(announceRevocations(['00000000-0000-0000-0000-000000000002']));
  });
});
