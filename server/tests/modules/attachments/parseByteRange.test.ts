import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseByteRange } from '../../../src/modules/attachments/attachmentServing.js';

describe('parseByteRange', () => {
  it('an absent or malformed header means no range', () => {
    assert.equal(parseByteRange(undefined, 1000), null);
    assert.equal(parseByteRange('', 1000), null);
    assert.equal(parseByteRange('bytes=-', 1000), null);
    assert.equal(parseByteRange('bytes=0-1,5-9', 1000), null);
    assert.equal(parseByteRange('items=0-1', 1000), null);
  });

  it('serves an explicit start-end range', () => {
    assert.deepEqual(parseByteRange('bytes=10-19', 1000), { start: 10, end: 19 });
  });

  it('an open-ended range runs to the last byte', () => {
    assert.deepEqual(parseByteRange('bytes=900-', 1000), { start: 900, end: 999 });
  });

  it('a suffix range returns the last N bytes, not the first N', () => {
    assert.deepEqual(parseByteRange('bytes=-65536', 1_000_000), { start: 934_464, end: 999_999 });
    assert.deepEqual(parseByteRange('bytes=-1', 1000), { start: 999, end: 999 });
  });

  it('a suffix longer than the file returns the whole file', () => {
    assert.deepEqual(parseByteRange('bytes=-5000', 1000), { start: 0, end: 999 });
  });

  it('a zero-length suffix or an empty file is unsatisfiable', () => {
    assert.equal(parseByteRange('bytes=-0', 1000), 'unsatisfiable');
    assert.equal(parseByteRange('bytes=-10', 0), 'unsatisfiable');
  });

  it('a start past the end of the file or an inverted range is unsatisfiable', () => {
    assert.equal(parseByteRange('bytes=1000-', 1000), 'unsatisfiable');
    assert.equal(parseByteRange('bytes=20-10', 1000), 'unsatisfiable');
    assert.equal(parseByteRange('bytes=0-1000', 1000), 'unsatisfiable');
  });
});
