import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAppPage } from '../../src/main/appPage.js';
import { parseBadgeCount } from '../../src/main/badge.js';

const APP = 'https://chat.example';

describe('isAppPage', () => {
  it('accepts only the app origin\'s top-level frame', () => {
    assert.equal(isAppPage({ parent: null, origin: APP }, APP), true);
    assert.equal(isAppPage({ parent: {} as never, origin: APP }, APP), false);
    assert.equal(isAppPage({ parent: null, origin: 'https://www.youtube.com' }, APP), false);
    assert.equal(isAppPage(null, APP), false);
  });
});

describe('parseBadgeCount', () => {
  it('takes a whole, non-negative count and caps it', () => {
    assert.equal(parseBadgeCount(0), 0);
    assert.equal(parseBadgeCount(12), 12);
    assert.equal(parseBadgeCount(123_456), 9999);
  });

  it('refuses anything else', () => {
    for (const value of [-1, 1.5, Number.NaN, Infinity, '3', null, undefined]) assert.equal(parseBadgeCount(value), null, String(value));
  });
});
