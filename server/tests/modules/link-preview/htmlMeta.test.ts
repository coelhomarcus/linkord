import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allMeta, charsetFromContentType, decodeBody, firstIframeSrc, firstMeta, firstParagraphText, parsePageMeta, plainText, sniffMetaCharset } from '../../../src/modules/link-preview/htmlMeta.js';

describe('parsePageMeta', () => {
  test('reads a meta whatever the order and quoting of its attributes', () => {
    const { metas } = parsePageMeta(`<head>
      <meta content="Content first" property="og:title">
      <meta name=description content='single quotes'>
      <meta itemprop="image" value="/schema.png">
      <META PROPERTY="OG:SITE_NAME" CONTENT="Upper">
    </head>`);
    assert.equal(firstMeta(metas, 'og:title'), 'Content first');
    assert.equal(firstMeta(metas, 'description'), 'single quotes');
    assert.equal(firstMeta(metas, 'image'), '/schema.png');
    assert.equal(firstMeta(metas, 'og:site_name'), 'Upper');
  });

  test('keeps every value of a key, in order', () => {
    const { metas } = parsePageMeta('<meta property="og:image" content="/a.png"><meta property="og:image" content="/b.png"><meta name="twitter:image" content="/c.png">');
    assert.deepEqual(allMeta(metas, 'og:image', 'twitter:image'), ['/a.png', '/b.png', '/c.png']);
  });

  test('decodes entities in attributes and in the title', () => {
    const { metas, title } = parsePageMeta('<title>Tom &amp; Jerry&#39;s &#x41;</title><meta property="og:description" content="it&apos;s &quot;quoted&quot;">');
    assert.equal(title, "Tom & Jerry's A");
    assert.equal(firstMeta(metas, 'og:description'), 'it\'s "quoted"');
  });

  test('ignores metas and titles inside script, style, noscript, template and svg', () => {
    const { metas, title } = parsePageMeta(`<head>
      <script>document.write('<meta property="og:title" content="from script">')</script>
      <noscript><meta property="og:title" content="from noscript"></noscript>
      <template><meta property="og:title" content="from template"></template>
      <style>/* <meta property="og:title" content="from style"> */</style>
      <svg><title>icon</title></svg>
      <title>  The   real
        title </title>
      <meta property="og:title" content="Real">
    </head>`);
    assert.deepEqual(metas.get('og:title'), ['Real']);
    assert.equal(title, 'The real title');
  });

  test('stops at the end of the head, wherever the response was cut', () => {
    const { metas, title } = parsePageMeta('<head><meta property="og:title" content="Head"></head><body><title>b</title><meta property="og:title" content="Body"></body>');
    assert.deepEqual(metas.get('og:title'), ['Head']);
    assert.equal(title, null);
    assert.deepEqual(parsePageMeta('<meta property="og:title" content="Implicit"><body><meta property="og:title" content="Body">').metas.get('og:title'), ['Implicit']);
  });

  test('takes the first icon link, whatever its rel spelling', () => {
    assert.equal(parsePageMeta('<link href="/a.png" rel="Shortcut Icon"><link rel="icon" href="/b.png">').favicon, '/a.png');
    assert.equal(parsePageMeta('<link rel="apple-touch-icon" href="/t.png">').favicon, '/t.png');
    assert.equal(parsePageMeta('<link rel="stylesheet" href="/s.css">').favicon, null);
  });

  test('firstMeta skips blank values and follows the order of the keys', () => {
    const { metas } = parsePageMeta('<meta property="og:title" content="  "><meta name="twitter:title" content="Twitter">');
    assert.equal(firstMeta(metas, 'og:title', 'twitter:title'), 'Twitter');
    assert.equal(firstMeta(metas, 'nothing'), null);
  });
});

describe('oEmbed html fragments', () => {
  test('firstParagraphText keeps only the text of the first paragraph', () => {
    const fragment = '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Hello <a href="https://t.co/x">world</a><br>line &amp; two</p>&mdash; Someone (@someone) <a href="https://x.com/a/status/1">Nov 1</a></blockquote><p>second</p>';
    assert.equal(firstParagraphText(fragment), 'Hello world\nline & two');
    assert.equal(firstParagraphText('<blockquote>no paragraph</blockquote>'), null);
  });

  test('plainText drops markup and decodes entities', () => {
    assert.equal(plainText('From the album,&nbsp;featured in <a href="https://x">this ad</a> &amp; more<br>next line'), 'From the album, featured in this ad & more\nnext line');
    assert.equal(plainText('  plain  '), 'plain');
    assert.equal(plainText('<b></b>'), null);
  });

  test('firstIframeSrc reads the first iframe only', () => {
    assert.equal(firstIframeSrc('<iframe width="200" src="https://www.youtube.com/embed/abc?feature=oembed"></iframe><iframe src="https://evil.example"></iframe>'), 'https://www.youtube.com/embed/abc?feature=oembed');
    assert.equal(firstIframeSrc('<blockquote>none</blockquote>'), null);
  });
});

describe('charset', () => {
  const latin1 = (text: string) => Buffer.from(text, 'latin1');

  test('reads the charset of a Content-Type header', () => {
    assert.equal(charsetFromContentType('text/html; charset=ISO-8859-1'), 'iso-8859-1');
    assert.equal(charsetFromContentType('text/html;charset="windows-1252"'), 'windows-1252');
    assert.equal(charsetFromContentType('text/html'), null);
  });

  test('finds <meta charset> and the http-equiv form in the first bytes', () => {
    assert.equal(sniffMetaCharset(latin1('<html><head><meta charset="ISO-8859-1">')), 'iso-8859-1');
    assert.equal(sniffMetaCharset(latin1('<meta content="text/html; charset=windows-1252" http-equiv="Content-Type">')), 'windows-1252');
    assert.equal(sniffMetaCharset(latin1(`${' '.repeat(2000)}<meta charset="iso-8859-1">`)), null, 'only the first 1024 bytes count');
  });

  test('decodes a latin-1 page declared in the header', () => {
    assert.equal(decodeBody(latin1('<title>Ação</title>'), 'text/html; charset=iso-8859-1'), '<title>Ação</title>');
  });

  test('decodes a latin-1 page declared only in its own <meta charset>', () => {
    assert.equal(decodeBody(latin1('<meta charset="iso-8859-1"><title>Coração</title>'), 'text/html'), '<meta charset="iso-8859-1"><title>Coração</title>');
  });

  test('a byte order mark wins over the header', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<title>ç</title>', 'utf8')]);
    assert.equal(decodeBody(bytes, 'text/html; charset=iso-8859-1'), '<title>ç</title>');
  });

  test('an unknown label falls back to UTF-8', () => {
    assert.equal(decodeBody(Buffer.from('<title>ç</title>', 'utf8'), 'text/html; charset=made-up'), '<title>ç</title>');
  });
});
