import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsolatedDatabase, isLocalDatabaseUrl, isSafeIsolatedName, withDatabase } from '../../src/scripts/rehearsal/isolatedDb.js';

describe('isolated database guards', () => {
  it('only accepts overcord_test_* / overcord_rehearsal_* names', () => {
    assert.equal(isSafeIsolatedName('overcord_test_ab12'), true);
    assert.equal(isSafeIsolatedName('overcord_rehearsal_x_9'), true);
    assert.equal(isSafeIsolatedName('overcord'), false);
    assert.equal(isSafeIsolatedName('call'), false);
    assert.equal(isSafeIsolatedName('overcord_test_prod'), false);
    assert.equal(isSafeIsolatedName('overcord_test_'), false);
  });

  it('only local hosts', () => {
    assert.equal(isLocalDatabaseUrl('postgres://u:p@localhost:5432/overcord'), true);
    assert.equal(isLocalDatabaseUrl('postgres://u:p@127.0.0.1:5432/overcord'), true);
    assert.equal(isLocalDatabaseUrl('postgres://u:p@69.62.93.80:5562/call'), false);
    assert.equal(isLocalDatabaseUrl('not-a-url'), false);
  });

  it('withDatabase swaps only the database name', () => {
    assert.equal(withDatabase('postgres://u:p@localhost:5432/overcord?x=1', 'postgres'), 'postgres://u:p@localhost:5432/postgres?x=1');
  });

  it('refuses to create a database on a remote host, before connecting', async () => {
    await assert.rejects(createIsolatedDatabase('postgres://u:p@69.62.93.80:5562/call', 'test'), /Postgres local/);
  });
});
