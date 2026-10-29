import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { retryAfterDelayMs, validPushSubscription } from '../../../src/modules/notifications/webPush.js';

const publicKey = Buffer.alloc(65, 1);
publicKey[0] = 4;
const keys = { p256dh: publicKey.toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };

describe('Web Push subscription validation', () => {
  it('accepts browser push service endpoints', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/token',
      'https://web.push.apple.com/Q123',
      'https://updates.push.services.mozilla.com/wpush/v2/token',
    ]) assert.equal(validPushSubscription({ endpoint, keys }), true);
  });

  it('rejects private or attacker-selected destinations', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/token',
      'https://127.0.0.1/push',
      'https://fcm.googleapis.com.evil.example/push',
      'https://user:pass@fcm.googleapis.com/push',
      'https://fcm.googleapis.com:444/push',
    ]) assert.equal(validPushSubscription({ endpoint, keys }), false);
  });

  it('rejects missing and malformed encryption keys', () => {
    assert.equal(validPushSubscription({ endpoint: 'https://fcm.googleapis.com/send', keys: { p256dh: 'short', auth: keys.auth } }), false);
    assert.equal(validPushSubscription({ endpoint: 'https://fcm.googleapis.com/send' }), false);
  });
});

describe('push service retry timing', () => {
  it('reads Retry-After seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    assert.equal(retryAfterDelayMs({ 'retry-after': '90' }, now), 90_000);
    assert.equal(retryAfterDelayMs({ 'Retry-After': 'Thu, 29 Oct 2026 12:02:00 GMT' }, now), 120_000);
  });

  it('ignores missing or invalid headers', () => {
    assert.equal(retryAfterDelayMs(undefined), 0);
    assert.equal(retryAfterDelayMs({ 'retry-after': 'invalid' }), 0);
  });
});
