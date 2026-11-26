import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HIDDEN_FLAG, startedHidden } from '../../src/main/loginItem.js';

describe('startedHidden', () => {
  it('is true for a start with the system, which passes the hidden flag', () => {
    assert.equal(startedHidden(['overcord', HIDDEN_FLAG]), true);
  });

  it('is false for a start by hand', () => {
    assert.equal(startedHidden(['overcord', '--url=https://chat.example']), false);
  });
});
