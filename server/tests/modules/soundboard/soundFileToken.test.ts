import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSoundFileToken, soundFileToken } from '../../../src/modules/soundboard/soundboard.js';

describe('sound file tokens', () => {
  const now = 1_700_000_000_000;

  it('opens the sound it was made for, for ten minutes', () => {
    const token = soundFileToken('server', 'sound', now);
    assert.equal(isValidSoundFileToken(token, 'server', 'sound', now + 9 * 60_000), true);
    assert.equal(isValidSoundFileToken(token, 'server', 'sound', now + 11 * 60_000), false);
  });

  it('opens nothing else', () => {
    const token = soundFileToken('server', 'sound', now);
    assert.equal(isValidSoundFileToken(token, 'server', 'other', now), false);
    assert.equal(isValidSoundFileToken(token, 'other', 'sound', now), false);
    const [expires, signature] = token.split('.');
    assert.equal(isValidSoundFileToken(`${Number(expires) + 60_000}.${signature}`, 'server', 'sound', now), false, 'a pushed-back expiry breaks the signature');
    for (const bad of [undefined, '', 'nope', '123.', '.abc']) assert.equal(isValidSoundFileToken(bad, 'server', 'sound', now), false);
  });
});
