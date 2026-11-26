import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBadgeId, sortBadges } from '../../../src/modules/badges/badgeCatalog.js';

describe('badge catalog', () => {
  it('knows only the badges it lists', () => {
    assert.equal(isBadgeId('developer'), true);
    assert.equal(isBadgeId('supporter'), true);
    assert.equal(isBadgeId('staff'), false);
    assert.equal(isBadgeId(undefined), false);
  });

  it('puts held badges in catalog order', () => {
    const sorted = sortBadges([{ id: 'supporter' as const, n: 1 }, { id: 'developer' as const, n: 2 }]);
    assert.deepEqual(sorted.map((badge) => badge.id), ['developer', 'supporter']);
  });
});
