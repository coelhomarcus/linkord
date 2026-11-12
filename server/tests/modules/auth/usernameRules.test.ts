import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../../src/config/env.js';
import { isReservedUsername, isValidUsername } from '../../../src/modules/auth/usernameRules.js';

describe('isValidUsername', () => {
  test('accepts letters, digits and . _ - within the length limits', () => {
    assert.equal(isValidUsername('ana'), true);
    assert.equal(isValidUsername('Ana.Lima_99-x'), true);
    assert.equal(isValidUsername('a'.repeat(config.MIN_USERNAME_LEN)), true);
    assert.equal(isValidUsername('a'.repeat(config.MAX_USERNAME_LEN)), true);
  });

  test('refuses names outside the length limits', () => {
    assert.equal(isValidUsername('a'.repeat(config.MIN_USERNAME_LEN - 1)), false);
    assert.equal(isValidUsername('a'.repeat(config.MAX_USERNAME_LEN + 1)), false);
    assert.equal(isValidUsername(''), false);
  });

  test('refuses spaces, @, accents and other symbols', () => {
    for (const name of ['ana lima', '@ana', 'joão', 'ana!', 'ana/x', 'ana\n']) {
      assert.equal(isValidUsername(name), false, name);
    }
  });
});

describe('isReservedUsername', () => {
  test('the group mentions are reserved in any letter case', () => {
    assert.equal(isReservedUsername('everyone'), true);
    assert.equal(isReservedUsername('Everyone'), true);
    assert.equal(isReservedUsername('HERE'), true);
    assert.equal(isReservedUsername('everyone2'), false);
  });
});
