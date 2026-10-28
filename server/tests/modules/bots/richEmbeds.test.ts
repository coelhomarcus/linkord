import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRichEmbeds, RICH_EMBED_LIMITS } from '../../../src/modules/bots/richEmbeds.js';

const ok = (raw: unknown) => {
  const result = parseRichEmbeds(raw);
  assert.ok('embeds' in result, 'error' in result ? result.error : '');
  return result.embeds;
};
const fails = (raw: unknown, pattern: RegExp) => {
  const result = parseRichEmbeds(raw);
  assert.ok('error' in result, 'expected an error');
  assert.match(result.error, pattern);
};

describe('parseRichEmbeds', () => {
  it('no embeds is an empty list, not an error', () => {
    assert.deepEqual(ok(undefined), []);
    assert.deepEqual(ok(null), []);
  });

  it('keeps a full embed, normalizing color, url, footer and timestamp', () => {
    const [embed] = ok([{
      title: ' Deploy ', description: 'feito', url: 'https://ci.example.com/run/1', color: '#57F287',
      fields: [{ name: 'Versão', value: '1.4.2', inline: true }, { name: 'Ambiente', value: 'prod' }],
      footer: { text: 'CI' }, timestamp: '2026-10-28T12:00:00-03:00',
    }]);
    assert.deepEqual(embed, {
      title: 'Deploy', description: 'feito', url: 'https://ci.example.com/run/1', color: 0x57f287,
      fields: [{ name: 'Versão', value: '1.4.2', inline: true }, { name: 'Ambiente', value: 'prod', inline: false }],
      footer: 'CI', timestamp: '2026-10-28T15:00:00.000Z',
    });
  });

  it('takes a color as a number, a hex string or a name', () => {
    assert.equal(ok([{ title: 'a', color: 0xff0000 }])[0]!.color, 0xff0000);
    assert.equal(ok([{ title: 'a', color: 'ff0000' }])[0]!.color, 0xff0000);
    assert.equal(ok([{ title: 'a', color: 'Red' }])[0]!.color, 0xed4245);
    fails([{ title: 'a', color: 'rosa' }], /color/);
    fails([{ title: 'a', color: 0x1000000 }], /color/);
  });

  it('refuses what the reader would have to trust: a non-http link', () => {
    fails([{ title: 'a', url: 'javascript:alert(1)' }], /http/);
    fails([{ title: 'a', url: 'not a url' }], /http/);
  });

  it('an embed needs something to show', () => {
    fails([{ color: 'red' }], /title.*description.*fields/);
    fails([{ title: '   ' }], /title/);
  });

  it('a field needs both a name and a value', () => {
    fails([{ fields: [{ name: 'só nome' }] }], /fields\[0\]/);
    fails([{ fields: 'x' }], /lista/);
  });

  it('enforces the limits instead of cutting', () => {
    fails(Array.from({ length: RICH_EMBED_LIMITS.perMessage + 1 }, () => ({ title: 'a' })), /máximo/);
    fails([{ title: 'x'.repeat(RICH_EMBED_LIMITS.title + 1) }], /title/);
    fails([{ fields: Array.from({ length: RICH_EMBED_LIMITS.fields + 1 }, () => ({ name: 'a', value: 'b' })) }], /campos/);
    fails([{ title: 'a', timestamp: 'ontem' }], /timestamp/);
  });

  it('says which embed is wrong', () => {
    fails([{ title: 'ok' }, { title: 1 }], /embeds\[1\]/);
  });
});
