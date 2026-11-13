import { describe, expect, it } from 'vitest';
import { parseInline, parseMessage, previewableLinks, spoileredLinks, trimUrl } from '@/features/chat/messageMarkup';

describe('parseInline', () => {
  it('bold, italic, strikethrough and code', () => {
    expect(parseInline('**forte** *leve* ~~feito~~ `x = 1`')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'forte' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'leve' }] },
      { type: 'text', text: ' ' },
      { type: 'strike', children: [{ type: 'text', text: 'feito' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'x = 1' },
    ]);
  });

  it("nested emphasis doesn't lose the rest of the text", () => {
    expect(parseInline('antes **a _b_ c** depois')).toEqual([
      { type: 'text', text: 'antes ' },
      { type: 'bold', children: [{ type: 'text', text: 'a ' }, { type: 'italic', children: [{ type: 'text', text: 'b' }] }, { type: 'text', text: ' c' }] },
      { type: 'text', text: ' depois' },
    ]);
  });

  it('inside code nothing is special: no mention, no link, no emphasis', () => {
    expect(parseInline('`@ana https://x.com **y**`')).toEqual([{ type: 'code', text: '@ana https://x.com **y**' }]);
  });

  it("mention only at the start of a word: an email doesn't become a mention", () => {
    expect(parseInline('fale com @ana ou ana@exemplo.com').filter((n) => n.type === 'mention')).toEqual([{ type: 'mention', name: 'ana' }]);
  });

  it("a trailing period after a mention doesn't become part of the name", () => {
    expect(parseInline('oi @ana.')).toEqual([{ type: 'text', text: 'oi ' }, { type: 'mention', name: 'ana' }, { type: 'text', text: '.' }]);
  });

  it("link: trailing punctuation and an unpaired parenthesis stay out; an underscore in the URL doesn't become italic", () => {
    expect(parseInline('veja (https://ex.com/a_b_c).')).toEqual([
      { type: 'text', text: 'veja (' },
      { type: 'link', url: 'https://ex.com/a_b_c', suppressed: false },
      { type: 'text', text: ').' },
    ]);
  });

  it('<url> is a link with no preview', () => {
    expect(parseInline('<https://ex.com>')).toEqual([{ type: 'link', url: 'https://ex.com', suppressed: true }]);
  });

  it('loose asterisks stay as text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }]);
  });

  it("snake_case doesn't become italic", () => {
    expect(parseInline('use minha_var_aqui')).toEqual([{ type: 'text', text: 'use minha_var_aqui' }]);
  });

  it('raw HTML is just text', () => {
    expect(parseInline('<b>oi</b><script>x</script>')).toEqual([{ type: 'text', text: '<b>oi</b><script>x</script>' }]);
  });
});

describe('trimUrl', () => {
  it('keeps balanced parentheses (wikipedia)', () => {
    expect(trimUrl('https://pt.wikipedia.org/wiki/Java_(linguagem)')).toBe('https://pt.wikipedia.org/wiki/Java_(linguagem)');
  });
});

describe('parseMessage', () => {
  it('code block with language, quote and lists', () => {
    const blocks = parseMessage('intro\n```ts\nconst a = 1;\n```\n> citado\n> segunda\n- um\n- dois\n1. primeiro');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'code', 'quote', 'list', 'list']);
    expect(blocks[1]).toEqual({ type: 'code', lang: 'ts', code: 'const a = 1;' });
    expect(blocks[3]).toMatchObject({ ordered: false, items: [[{ type: 'text', text: 'um' }], [{ type: 'text', text: 'dois' }]] });
    expect(blocks[4]).toMatchObject({ ordered: true });
  });

  it('an unclosed fence stays as text', () => {
    expect(parseMessage('```\nsem fim').map((b) => b.type)).toEqual(['paragraph']);
  });

  it("an old plain message doesn't change: line breaks preserved, no headings", () => {
    expect(parseMessage('# nao e titulo\nlinha 2')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: '# nao e titulo\nlinha 2' }] }]);
  });
});

describe('previewableLinks', () => {
  it('ignores links in code and suppressed ones, dedupes and caps at five', () => {
    const text = '`https://code.com` <https://quiet.com> https://a.com https://a.com https://b.com?q=1 https://c.com https://d.com https://e.com https://f.com';
    expect(previewableLinks(parseMessage(text))).toEqual(['https://a.com', 'https://b.com?q=1', 'https://c.com', 'https://d.com', 'https://e.com']);
  });

  it("a code block doesn't generate a preview", () => {
    expect(previewableLinks(parseMessage('```\nhttps://x.com\n```'))).toEqual([]);
  });
});

describe('parseInline — server emojis', () => {
  it('reads <:name:id> and <a:name:id> as server emojis', () => {
    expect(parseInline('oi <:wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa> e <a:party:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>')).toEqual([
      { type: 'text', text: 'oi ' },
      { type: 'customEmoji', name: 'wave', id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', animated: false },
      { type: 'text', text: ' e ' },
      { type: 'customEmoji', name: 'party', id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', animated: true },
    ]);
  });

  it('leaves one inside code as code', () => {
    expect(parseInline('`<:wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>`')).toEqual([{ type: 'code', text: '<:wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>' }]);
  });
});

describe('parseInline — role mentions', () => {
  const ROLE = '11111111-1111-4111-8111-111111111111';
  it('a <@&id> token is a role mention, outside code only; anything else stays text', () => {
    expect(parseInline(`oi <@&${ROLE}>!`)).toEqual([{ type: 'text', text: 'oi ' }, { type: 'roleMention', roleId: ROLE }, { type: 'text', text: '!' }]);
    expect(parseInline(`\`<@&${ROLE}>\``)).toEqual([{ type: 'code', text: `<@&${ROLE}>` }]);
    expect(parseInline('<@&moderacao>')).toEqual([{ type: 'text', text: '<@&moderacao>' }]);
  });

  it('@everyone and @here parse like names; the renderer tells them apart', () => {
    expect(parseInline('@everyone @here')).toEqual([{ type: 'mention', name: 'everyone' }, { type: 'text', text: ' ' }, { type: 'mention', name: 'here' }]);
  });
});

describe('spoilers', () => {
  it('||text|| is a spoiler, and what is inside it is still formatted', () => {
    expect(parseInline('olha ||o **final**|| aqui')).toEqual([
      { type: 'text', text: 'olha ' },
      { type: 'spoiler', children: [{ type: 'text', text: 'o ' }, { type: 'bold', children: [{ type: 'text', text: 'final' }] }] },
      { type: 'text', text: ' aqui' },
    ]);
  });

  it('a link inside one keeps its address whole and still gets a card, marked as hidden', () => {
    const blocks = parseMessage('||https://ex.com/post|| e https://open.com');
    expect(previewableLinks(blocks)).toEqual(['https://ex.com/post', 'https://open.com']);
    expect([...spoileredLinks(blocks)]).toEqual(['https://ex.com/post']);
  });

  it('a lone pair of bars is just text', () => {
    expect(parseInline('a || b')).toEqual([{ type: 'text', text: 'a || b' }]);
  });
});
