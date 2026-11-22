import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAppPage } from '../../src/main/appPage.js';

const APP = 'https://chat.example';

describe('isAppPage', () => {
  it('accepts only the app origin\'s top-level frame', () => {
    assert.equal(isAppPage({ parent: null, origin: APP }, APP), true);
    assert.equal(isAppPage({ parent: {} as never, origin: APP }, APP), false);
    assert.equal(isAppPage({ parent: null, origin: 'https://www.youtube.com' }, APP), false);
    assert.equal(isAppPage(null, APP), false);
  });
});
