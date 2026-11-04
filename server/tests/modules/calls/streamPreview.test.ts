import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPreviewBroker, isValidPreviewImage, MAX_PREVIEW_CHARS } from '../../../src/modules/calls/streamPreview.js';

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

  it('a streamer that never answers releases the waiters empty-handed', async () => {
    const broker = createPreviewBroker({ ttlMs: 10_000, timeoutMs: 5 });
    const answer = await new Promise<string | null>((resolve) => { broker.request('s1', resolve); });
    assert.equal(answer, null);
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
