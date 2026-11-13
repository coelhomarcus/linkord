import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { usernameTag } from '../../../src/modules/auth/logPseudonym.js';

describe('usernameTag', () => {
  it('never contains the typed text and stays short', () => {
    const tag = usernameTag('hunter2-my-password');
    assert.match(tag, /^[0-9a-f]{12}$/);
    assert.ok(!tag.includes('hunter2'));
  });

  it('is the same for the same name, ignoring case and spaces, and differs for another', () => {
    assert.equal(usernameTag('Alice '), usernameTag('alice'));
    assert.notEqual(usernameTag('alice'), usernameTag('bob'));
  });
});
