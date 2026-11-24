import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPlaygroundToken } from '../src/access.js';
// the app signs, this service reads: both ends of the same pass
import { signPlaygroundToken } from '../../server/src/modules/playground/playgroundToken.js';

const SECRET = 'a'.repeat(32);
const claims = { pid: 'conn-1', uid: 'user-1', cid: 'conv-1', exp: 2_000 };

describe('verifyPlaygroundToken', () => {
  test('reads what the app signed', () => {
    assert.deepEqual(verifyPlaygroundToken(signPlaygroundToken(claims, SECRET), SECRET, 1_000), claims);
  });

  test('refuses an expired pass', () => {
    assert.equal(verifyPlaygroundToken(signPlaygroundToken(claims, SECRET), SECRET, 2_000), null);
  });

  test('refuses another secret, a changed body and garbage', () => {
    const token = signPlaygroundToken(claims, SECRET);
    assert.equal(verifyPlaygroundToken(token, 'b'.repeat(32), 1_000), null);
    const [, mac] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...claims, uid: 'someone-else' })).toString('base64url')}.${mac}`;
    assert.equal(verifyPlaygroundToken(forged, SECRET, 1_000), null);
    for (const garbage of [undefined, '', '.', 'abc', 'abc.def', 42, 'x'.repeat(5000)]) assert.equal(verifyPlaygroundToken(garbage, SECRET, 1_000), null);
  });

  test('refuses a signed pass without every claim', () => {
    const partial = signPlaygroundToken({ ...claims, cid: '' }, SECRET);
    assert.equal(verifyPlaygroundToken(partial, SECRET, 1_000), null);
  });
});
