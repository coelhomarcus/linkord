import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PG_INT4_MAX, parseSerialId } from '../../src/db/serialId.js';

describe('parseSerialId', () => {
  it('accepts positive integers up to the int4 ceiling, as numbers or digit strings', () => {
    assert.equal(parseSerialId(1), 1);
    assert.equal(parseSerialId(PG_INT4_MAX), PG_INT4_MAX);
    assert.equal(parseSerialId('42'), 42);
    assert.equal(parseSerialId(String(PG_INT4_MAX)), PG_INT4_MAX);
  });

  it('rejects what Postgres would refuse or what cannot name a row', () => {
    for (const value of [0, -1, 1.5, PG_INT4_MAX + 1, 99999999999, NaN, Infinity, '0', '3000000000', '99999999999', '1.5', '-1', '1e3', ' 1', '', null, undefined, true, {}, [1]]) {
      assert.equal(parseSerialId(value), null, `accepted ${String(value)}`);
    }
  });
});
