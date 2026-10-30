import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidEmail, normalizeEmail, publicUser } from '../../../src/modules/users/users.js';
import type { User } from '../../../src/db/schema.js';

describe('authentication email', () => {
  it('normalizes spaces and uppercase', () => {
    assert.equal(normalizeEmail('  Pessoa@Exemplo.COM '), 'pessoa@exemplo.com');
  });

  it('validates basic format and rejects incomplete values', () => {
    assert.equal(isValidEmail('pessoa@exemplo.com'), true);
    assert.equal(isValidEmail('pessoa@exemplo'), false);
    assert.equal(isValidEmail('pessoa exemplo.com'), false);
  });
});

describe('publicUser', () => {
  it("carries the avatar's still frame, so lists can show it until hovered", () => {
    const row = {
      id: 'u', username: 'ana', displayName: 'Ana', avatar: '/uploads/a.gif', avatarPoster: '/uploads/a.webp', avatarColor: 'blurple',
      banner: '', bio: '', profileLinks: [], role: 'user', lastSeenAt: null,
    } as unknown as User;
    assert.equal(publicUser(row).avatarPoster, '/uploads/a.webp');
  });
});
