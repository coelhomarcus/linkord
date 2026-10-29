import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mentionedUsernames, previewableLinks } from '../../../src/modules/link-preview/messageLinks.js';

// the same cases as web/tests/features/chat/messageMarkup.test.ts: the server
// stores previews for exactly the cards the client draws
describe('previewableLinks (mirror of the client)', () => {
  test('ignores links in code and suppressed ones, dedupes and caps at three', () => {
    const text = '`https://code.com` <https://quiet.com> https://a.com https://a.com https://b.com?q=1 https://c.com https://d.com';
    assert.deepEqual(previewableLinks(text), ['https://a.com', 'https://b.com?q=1', 'https://c.com']);
  });

  test("a code block doesn't generate a preview", () => {
    assert.deepEqual(previewableLinks('```\nhttps://x.com\n```'), []);
    assert.deepEqual(previewableLinks('```https://x.com```'), []);
  });

  test('a link ending a sentence leaves the punctuation and an unmatched parenthesis out', () => {
    assert.deepEqual(previewableLinks('olha isso: https://site.com/a. e (veja https://b.com/x)'), ['https://site.com/a', 'https://b.com/x']);
  });

  test('links inside emphasis, quotes and lists count', () => {
    assert.deepEqual(previewableLinks('**https://a.com**\n> https://b.com\n- https://c.com'), ['https://a.com', 'https://b.com', 'https://c.com']);
  });
});

// the same rule the client uses to draw a mention chip (messageMarkup.ts)
describe('mentionedUsernames', () => {
  test('lowercased and each once, from paragraphs, quotes, lists and emphasis', () => {
    assert.deepEqual(mentionedUsernames('@Ana e @bia\n> @carla\n- @davi\n**@ana** _@eva_'), ['ana', 'bia', 'carla', 'davi', 'eva']);
  });

  test('never inside code, nor the tail of an e-mail, nor a trailing period', () => {
    assert.deepEqual(mentionedUsernames('`@code` ana@mail.com fala com @bia.\n```\n@bloco\n```'), ['bia']);
  });

  test('a message with no mention has none', () => {
    assert.deepEqual(mentionedUsernames('oi, tudo bem?'), []);
  });
});
