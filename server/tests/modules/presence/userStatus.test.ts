import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_STATUS_MAX_TTL_MS, CUSTOM_STATUS_TEXT_MAX, effectiveStatus, isCustomStatusExpired, isPresenceStatus,
  sanitizeCustomStatus, sanitizeStatusEmoji, sanitizeStatusText,
} from '../../../src/modules/presence/userStatus.js';

describe('presence status values', () => {
  test('accepts only the four statuses', () => {
    for (const value of ['online', 'idle', 'dnd', 'invisible']) assert.equal(isPresenceStatus(value), true);
    for (const value of ['offline', '', null, 1, 'ONLINE']) assert.equal(isPresenceStatus(value), false);
  });

  test('automatic idle only replaces online, and only when every connection is idle', () => {
    assert.equal(effectiveStatus('online', true), 'idle');
    assert.equal(effectiveStatus('online', false), 'online');
    assert.equal(effectiveStatus('dnd', true), 'dnd');
    assert.equal(effectiveStatus('invisible', true), 'invisible');
  });
});

describe('custom status emoji', () => {
  test('keeps a single emoji, including sequences and flags', () => {
    for (const emoji of ['🎮', '👍🏽', '👩‍💻', '🇧🇷', '❤️', '1️⃣']) assert.equal(sanitizeStatusEmoji(emoji), emoji);
  });

  test('drops text, several emoji and anything that is not a string', () => {
    for (const value of ['a', 'abc', '🎮🎮', '1', ' ', '<b>', 42, null, undefined]) assert.equal(sanitizeStatusEmoji(value), '');
  });
});

describe('custom status text', () => {
  test('collapses whitespace and control characters to one line', () => {
    assert.equal(sanitizeStatusText('  jogando\n\tElden   Ring  '), 'jogando Elden Ring');
    assert.equal(sanitizeStatusText('a\u0000b‮c'), 'a b c');
  });

  test('caps the length in characters, not UTF-16 units', () => {
    const text = sanitizeStatusText('🎮'.repeat(CUSTOM_STATUS_TEXT_MAX + 10));
    assert.equal(Array.from(text).length, CUSTOM_STATUS_TEXT_MAX);
  });
});

describe('sanitizeCustomStatus', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');

  test('an empty emoji and text clears the status', () => {
    assert.equal(sanitizeCustomStatus({ emoji: '', text: '   ' }, now), null);
    assert.equal(sanitizeCustomStatus(null, now), null);
    assert.equal(sanitizeCustomStatus('🎮', now), null);
  });

  test('keeps a future expiry and normalizes it', () => {
    const value = sanitizeCustomStatus({ emoji: '🎮', text: 'jogando', expiresAt: '2026-11-08T13:00:00.000Z' }, now);
    assert.deepEqual(value, { emoji: '🎮', text: 'jogando', expiresAt: '2026-11-08T13:00:00.000Z' });
  });

  test('no expiry means never', () => {
    assert.deepEqual(sanitizeCustomStatus({ text: 'hi' }, now), { emoji: '', text: 'hi', expiresAt: null });
  });

  test('a past or malformed expiry clears instead of setting a status that never ends', () => {
    assert.equal(sanitizeCustomStatus({ text: 'hi', expiresAt: '2026-11-08T11:00:00Z' }, now), null);
    assert.equal(sanitizeCustomStatus({ text: 'hi', expiresAt: 'soon' }, now), null);
    assert.equal(sanitizeCustomStatus({ text: 'hi', expiresAt: 123 }, now), null);
  });

  test('a far expiry is clamped to the maximum', () => {
    const value = sanitizeCustomStatus({ text: 'hi', expiresAt: '2030-01-01T00:00:00Z' }, now);
    assert.equal(value?.expiresAt, new Date(now + CUSTOM_STATUS_MAX_TTL_MS).toISOString());
  });

  test('expiry check', () => {
    assert.equal(isCustomStatusExpired(null, now), false);
    assert.equal(isCustomStatusExpired({ emoji: '', text: 'x', expiresAt: null }, now), false);
    assert.equal(isCustomStatusExpired({ emoji: '', text: 'x', expiresAt: '2026-11-08T12:00:00Z' }, now), true);
  });
});
