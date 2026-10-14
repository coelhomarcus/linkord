import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gifConfigFor, klipyCustomerId } from '../../../src/modules/gifs/gifs.js';

describe('klipyCustomerId', () => {
  it('is stable for one user, so KLIPY keeps their recent GIFs', () => {
    assert.equal(klipyCustomerId('user-1'), klipyCustomerId('user-1'));
  });

  it('differs between users and never carries the account id itself', () => {
    const id = klipyCustomerId('6f1c2d3e-aaaa-bbbb-cccc-1234567890ab');
    assert.notEqual(id, klipyCustomerId('user-2'));
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.ok(!id.includes('6f1c2d3e'));
  });
});

describe('gifConfigFor', () => {
  it('without a key, the picker is off and nothing else is sent', () => {
    assert.deepEqual(gifConfigFor('user-1', ''), { enabled: false });
  });

  it('with a key, hands it over with that user customer id', () => {
    assert.deepEqual(gifConfigFor('user-1', 'k'), { enabled: true, apiKey: 'k', customerId: klipyCustomerId('user-1') });
  });
});
