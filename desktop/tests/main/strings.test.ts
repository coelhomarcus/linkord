import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, format, stringsFor } from '../../src/main/strings.js';

const variables = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe('strings', () => {
  it('has the same keys and variables in every language', () => {
    const [source, ...others] = Object.values(STRINGS);
    for (const other of others) {
      assert.deepEqual(Object.keys(other).sort(), Object.keys(source).sort());
      for (const key of Object.keys(source) as (keyof typeof source)[]) {
        assert.deepEqual(variables(other[key]), variables(source[key]), key);
      }
    }
  });

  it('picks Portuguese for any Portuguese system, English otherwise', () => {
    assert.equal(stringsFor(['pt-BR', 'en-US']), STRINGS['pt-BR']);
    assert.equal(stringsFor(['pt-PT']), STRINGS['pt-BR']);
    assert.equal(stringsFor(['fr-FR', 'pt-BR']), STRINGS['en-US']);
    assert.equal(stringsFor([]), STRINGS['en-US']);
  });

  it('fills variables and leaves unknown ones', () => {
    assert.equal(format('v{{version}} {{other}}', { version: '1.2.0' }), 'v1.2.0 {{other}}');
  });
});
