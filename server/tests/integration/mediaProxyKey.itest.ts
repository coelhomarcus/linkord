import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { instanceSecrets } from '../../src/db/schema.js';
import { loadMediaProxyKey } from '../../src/modules/media-proxy/mediaProxyKey.js';
import { proxiedImageUrl, setMediaProxyKey } from '../../src/modules/media-proxy/mediaProxyUrls.js';
import { db, pool } from './helpers.js';

after(async () => { setMediaProxyKey(null); await pool.end(); });

describe('media proxy key (real Postgres)', () => {
  it('is made once and read back the same, so addresses outlive a restart', async () => {
    await db.delete(instanceSecrets);
    await loadMediaProxyKey();
    const first = proxiedImageUrl('preview', 'https://example.com/og.png');
    setMediaProxyKey(null);
    await loadMediaProxyKey();
    assert.equal(proxiedImageUrl('preview', 'https://example.com/og.png'), first);
    assert.equal((await db.select().from(instanceSecrets)).length, 1);
  });
});
