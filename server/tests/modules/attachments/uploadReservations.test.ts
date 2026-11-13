import { uploadDir } from '../../integration/isolatedUploadDir.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import { config } from '../../../src/config/env.js';
import {
  completingUploads, expireIdleUploads, getReservedBytes, manifestPathFor, openUploadsOf, releaseUpload, reserveUpload,
  sweepStaleUploads, tmpDirFor, touchUpload, type UploadManifest,
} from '../../../src/modules/attachments/uploadSession.js';

const ids = new Set<string>();
let next = 0;

function session(userId: string, totalSize: number, { createdAtMs = Date.now(), filesAtMs }: { createdAtMs?: number; filesAtMs?: number } = {}): string {
  const uploadId = `upload-${next++}`;
  ids.add(uploadId);
  fs.mkdirSync(tmpDirFor(uploadId), { recursive: true });
  fs.writeFileSync(manifestPathFor(uploadId), JSON.stringify({
    uploadId, userId, conversationId: 'c', fileName: 'f', mimeType: 'application/octet-stream', totalSize,
    chunkSize: config.UPLOAD_CHUNK_BYTES, totalChunks: 1, createdAt: new Date(createdAtMs).toISOString(),
  } satisfies UploadManifest));
  const at = new Date(filesAtMs ?? createdAtMs);
  fs.utimesSync(manifestPathFor(uploadId), at, at);
  return uploadId;
}

afterEach(() => {
  for (const id of ids) releaseUpload(id);
  ids.clear();
  completingUploads.clear();
  fs.rmSync(path.join(uploadDir, 'tmp'), { recursive: true, force: true });
});
after(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

describe('upload reservations', () => {
  it('are counted per account, and an upload checking for itself leaves its own out', () => {
    const a1 = session('alice', 100);
    const a2 = session('alice', 50);
    const b1 = session('bob', 7);
    reserveUpload(a1, 'alice', 100);
    reserveUpload(a2, 'alice', 50);
    reserveUpload(b1, 'bob', 7);
    assert.deepEqual(openUploadsOf('alice'), { count: 2, bytes: 150 });
    assert.deepEqual(openUploadsOf('bob'), { count: 1, bytes: 7 });
    assert.equal(getReservedBytes(), 157);
    assert.equal(getReservedBytes(a1), 57);
  });

  it('one that gets no chunk for the idle window is given back with its files; a fed or completing one stays', async () => {
    const now = Date.now();
    const old = now - config.UPLOAD_IDLE_TTL_MS - 1000;
    const idle = session('alice', 100);
    const fed = session('alice', 100);
    const completing = session('alice', 100);
    for (const id of [idle, fed, completing]) reserveUpload(id, 'alice', 100, old);
    touchUpload(fed, now);
    completingUploads.add(completing);

    assert.equal(await expireIdleUploads(now), 1);
    assert.equal(fs.existsSync(tmpDirFor(idle)), false);
    assert.equal(fs.existsSync(tmpDirFor(fed)), true);
    assert.deepEqual(openUploadsOf('alice'), { count: 2, bytes: 200 });
  });
});

describe('sweepStaleUploads', () => {
  it('rebuilds reservations after a restart, owner included, from what is on disk', async () => {
    const id = session('alice', 300);
    await sweepStaleUploads();
    assert.deepEqual(openUploadsOf('alice'), { count: 1, bytes: 300 });
    assert.equal(fs.existsSync(tmpDirFor(id)), true);
  });

  it('drops a session that declared a size and never sent a byte once the idle window is over', async () => {
    const longAgo = Date.now() - config.UPLOAD_IDLE_TTL_MS - 60_000;
    const id = session('alice', 300, { createdAtMs: longAgo });
    await sweepStaleUploads();
    assert.equal(fs.existsSync(tmpDirFor(id)), false);
    assert.deepEqual(openUploadsOf('alice'), { count: 0, bytes: 0 });
  });

  it('keeps an old session whose last chunk is recent', async () => {
    const longAgo = Date.now() - config.UPLOAD_IDLE_TTL_MS - 60_000;
    const id = session('alice', 300, { createdAtMs: longAgo });
    fs.writeFileSync(path.join(tmpDirFor(id), '000000'), 'chunk');
    await sweepStaleUploads();
    assert.equal(fs.existsSync(tmpDirFor(id)), true);
    assert.deepEqual(openUploadsOf('alice'), { count: 1, bytes: 300 });
  });

  it('drops a session past the absolute lifetime even if it is still being fed', async () => {
    const id = session('alice', 300, { createdAtMs: Date.now() - config.UPLOAD_SESSION_TTL_MS - 1000, filesAtMs: Date.now() });
    await sweepStaleUploads();
    assert.equal(fs.existsSync(tmpDirFor(id)), false);
  });
});
