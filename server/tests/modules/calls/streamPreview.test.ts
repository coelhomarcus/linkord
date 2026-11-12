import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPreviewBroker, isValidPreviewImage, MAX_PREVIEW_CHARS, STREAM_PREVIEW_PERMISSIONS } from '../../../src/modules/calls/streamPreview.js';
import { hasPermission, PERMISSIONS } from '../../../src/modules/servers/permissions.js';

function clock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

describe('createPreviewBroker', () => {
  it('the first request asks the streamer for a capture, and its frame answers everyone who waited', () => {
    const time = clock();
    const broker = createPreviewBroker({ ttlMs: 10_000, timeoutMs: 5_000, now: time.now });
    const answers: (string | null)[] = [];
    assert.equal(broker.request('s1', (image) => answers.push(image)), 'capture');
    assert.equal(broker.request('s1', (image) => answers.push(image)), 'waiting');
    assert.equal(broker.deliver('s1', 'data:image/jpeg;base64,AAAA'), true);
    assert.deepEqual(answers, ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,AAAA']);
  });

  it('a fresh frame answers from memory without waking the streamer', () => {
    const time = clock();
    const broker = createPreviewBroker({ ttlMs: 10_000, timeoutMs: 5_000, now: time.now });
    broker.request('s1', () => {});
    broker.deliver('s1', 'data:image/jpeg;base64,AAAA');
    time.advance(9_000);
    let answer: string | null = null;
    assert.equal(broker.request('s1', (image) => { answer = image; }), 'cached');
    assert.equal(answer, 'data:image/jpeg;base64,AAAA');
  });

  it('an old frame is not "now" anymore: a new capture is asked for', () => {
    const time = clock();
    const broker = createPreviewBroker({ ttlMs: 10_000, timeoutMs: 5_000, now: time.now });
    broker.request('s1', () => {});
    broker.deliver('s1', 'data:image/jpeg;base64,AAAA');
    time.advance(10_000);
    assert.equal(broker.request('s1', () => {}), 'capture');
  });

  it('a frame nobody asked for is dropped', () => {
    const broker = createPreviewBroker({ ttlMs: 10_000, timeoutMs: 5_000 });
    assert.equal(broker.deliver('s1', 'data:image/jpeg;base64,AAAA'), false);
    assert.equal(broker.request('s1', () => {}), 'capture');
  });

  it('a streamer that never answers releases the waiters empty-handed', (t) => {
    // The broker unrefs its timeout so it never holds the process open; a real
    // timer would let the event loop drain before it fires, so drive it by hand.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const broker = createPreviewBroker({ ttlMs: 10_000, timeoutMs: 5_000 });
    const answers: (string | null)[] = [];
    broker.request('s1', (image) => answers.push(image));
    broker.request('s1', (image) => answers.push(image));
    t.mock.timers.tick(4_999);
    assert.deepEqual(answers, []);
    t.mock.timers.tick(1);
    assert.deepEqual(answers, [null, null]);
    // and the next hover may ask again
    assert.equal(broker.request('s1', () => {}), 'capture');
  });
});

describe('isValidPreviewImage', () => {
  it('takes a JPEG or WebP data URL', () => {
    assert.equal(isValidPreviewImage('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
    assert.equal(isValidPreviewImage('data:image/webp;base64,UklGRg=='), true);
  });

  it('refuses anything else: other types, markup, oversized frames', () => {
    assert.equal(isValidPreviewImage('data:image/svg+xml;base64,PHN2Zz4='), false);
    assert.equal(isValidPreviewImage('https://example.com/a.jpg'), false);
    assert.equal(isValidPreviewImage('data:image/jpeg;base64,AA"><script>'), false);
    assert.equal(isValidPreviewImage(`data:image/jpeg;base64,${'A'.repeat(MAX_PREVIEW_CHARS)}`), false);
    assert.equal(isValidPreviewImage(42), false);
  });
});

describe('STREAM_PREVIEW_PERMISSIONS', () => {
  it('asks for what joining the call asks for, not only seeing the channel', () => {
    assert.equal(hasPermission(PERMISSIONS.VIEW_CHANNEL, STREAM_PREVIEW_PERMISSIONS), false);
    assert.equal(hasPermission(PERMISSIONS.CONNECT, STREAM_PREVIEW_PERMISSIONS), false);
    assert.equal(hasPermission(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT, STREAM_PREVIEW_PERMISSIONS), true);
  });
});
