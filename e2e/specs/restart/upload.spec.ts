import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { sql, startApp, stopApp } from '../../stack/stack';

const FILE_BYTES = 40 * 1024 * 1024;
const UPLOAD_BYTES_PER_SECOND = 1024 * 1024;

// The server keeps an upload's chunks on disk and the client retries through an
// outage of up to 60 s, so a deploy in the middle of a big upload must cost
// nothing but time (shared/lib/chunkedUpload.ts).
for (const outageSeconds of [10, 30]) {
  test(`a 40 MB upload survives a ${outageSeconds}s outage and arrives intact`, async ({ users }, testInfo) => {
    test.setTimeout(240_000);
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E upload restart');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const a = await alice.app();
    const b = await bob.app();
    await a.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);

    const content = randomBytes(FILE_BYTES);
    const name = `grande-${outageSeconds}s.bin`;
    const file = testInfo.outputPath(name);
    writeFileSync(file, content);

    // slow the upload down so the outage lands in the middle of it
    const cdp = await a.page.context().newCDPSession(a.page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: UPLOAD_BYTES_PER_SECOND });

    await a.page.locator('input[type=file]:not([accept])').setInputFiles(file);
    const text = `arquivo durante o deploy ${outageSeconds}s`;
    await a.send(text);
    await a.page.waitForTimeout(12_000);

    stopApp();
    await a.page.waitForTimeout(outageSeconds * 1000);
    await startApp();

    const row = b.message(text);
    await expect(row).toBeVisible({ timeout: 120_000 });
    await expect(row.getByText(name)).toBeVisible();
    await expect(a.page.getByText('Não enviada')).toHaveCount(0);

    // what the server kept is byte for byte what was sent
    const attachmentId = sql(`SELECT a.id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.text = '${text}' AND NOT a.is_thumbnail`);
    expect(attachmentId).toBeTruthy();
    const download = await bob.api.get(`/uploads/${attachmentId}`);
    expect(download.ok()).toBe(true);
    const received = createHash('sha256').update(await download.body()).digest('hex');
    expect(received).toBe(createHash('sha256').update(content).digest('hex'));
  });
}
