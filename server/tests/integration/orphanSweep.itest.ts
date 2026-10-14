import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import { attachments, messages, stagedAttachments } from '../../src/db/schema.js';
import { newId } from '../../src/modules/attachments/attachmentStorage.js';
import { sweepOrphans } from '../../src/modules/attachments/orphanSweeper.js';
import { db, makeGroupWithMembers, makeUser, pool } from './helpers.js';

after(async () => {
  await pool.end();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

// every kind of file the app keeps, written old enough (48h > the 24h grace) that only
// a database reference — not the grace period — can be what protects it
const DAY = 24 * 60 * 60 * 1000;

function writeFile(id: string, ageMs: number): void {
  const full = path.join(uploadDir, id);
  fs.writeFileSync(full, 'x');
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(full, when, when);
}
const exists = (id: string) => fs.existsSync(path.join(uploadDir, id));

afterEach(() => {
  for (const name of fs.readdirSync(uploadDir)) fs.rmSync(path.join(uploadDir, name), { recursive: true, force: true });
});

describe('orphan sweep, end to end (real Postgres and disk)', () => {
  async function seedEverything() {
    const owner = await makeUser('sweep');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    const ids = { published: newId(), publishedThumb: newId(), staged: newId(), stagedThumb: newId(), avatar: newId(), avatarPoster: newId(), orphan: newId(), recentOrphan: newId() };

    const [message] = await db.insert(messages).values({ conversationId, authorId: owner.id, text: '' }).returning();
    await db.insert(attachments).values([
      { id: ids.published, messageId: message!.id, fileName: 'a.png', mimeType: 'image/png', size: 1, thumbId: ids.publishedThumb },
      { id: ids.publishedThumb, messageId: message!.id, fileName: 'a.png', mimeType: 'image/jpeg', size: 1, isThumbnail: true },
      // profile images: no message, owned by the uploader
      { id: ids.avatar, messageId: null, uploaderId: owner.id, fileName: 'avatar', mimeType: 'image/gif', size: 1 },
      { id: ids.avatarPoster, messageId: null, uploaderId: owner.id, fileName: 'avatar-poster', mimeType: 'image/jpeg', size: 1 },
    ]);
    await db.insert(stagedAttachments).values({
      id: ids.staged, ownerId: owner.id, conversationId, fileName: 'b.png', mimeType: 'image/png', size: 1,
      thumbId: ids.stagedThumb, thumbMimeType: 'image/jpeg', thumbSize: 1, expiresAt: new Date(Date.now() + DAY),
    });

    for (const id of [ids.published, ids.publishedThumb, ids.staged, ids.stagedThumb, ids.avatar, ids.avatarPoster, ids.orphan]) writeFile(id, 2 * DAY);
    writeFile(ids.recentOrphan, 60_000);
    fs.writeFileSync(path.join(uploadDir, 'not-one-of-ours.txt'), 'x');
    fs.mkdirSync(path.join(uploadDir, 'tmp'), { recursive: true });
    return ids;
  }

  it('a dry run reports the orphan and deletes nothing', async () => {
    const ids = await seedEverything();
    const result = await sweepOrphans({ dryRun: true, actor: null });
    assert.equal(result.orphanCount, 1);
    assert.equal(result.deleted, 0);
    assert.equal(result.recent, 1);
    assert.ok(exists(ids.orphan));
  });

  it('a real run removes only the old file nothing points to', async () => {
    const ids = await seedEverything();
    const result = await sweepOrphans({ dryRun: false, actor: null });
    assert.deepEqual([result.orphanCount, result.deleted, result.failed], [1, 1, 0]);

    assert.equal(exists(ids.orphan), false, 'the true orphan is gone');
    for (const [name, id] of Object.entries(ids)) {
      if (name === 'orphan') continue;
      assert.equal(exists(id), true, `${name} must survive`);
    }
    assert.ok(fs.existsSync(path.join(uploadDir, 'not-one-of-ours.txt')), 'foreign files are never touched');
    assert.ok(fs.existsSync(path.join(uploadDir, 'tmp')), 'the upload scratch folder is never touched');
  });

  it('once the message is deleted its rows go with it, and the files become orphans', async () => {
    const ids = await seedEverything();
    await db.delete(messages); // attachments.message_id cascades; staged and profile rows stay
    const result = await sweepOrphans({ dryRun: false, actor: null });
    assert.equal(exists(ids.published), false);
    assert.equal(exists(ids.publishedThumb), false);
    for (const id of [ids.staged, ids.stagedThumb, ids.avatar, ids.avatarPoster]) assert.equal(exists(id), true);
    assert.equal(result.deleted, 3);
  });
});
