import { describe, expect, it } from 'vitest';
import { ALIASES, GRAMMARS, highlightCode, isHighlighterMarkup } from '@/shared/lib/highlightCode';

// Markup that would break out of the code block, or fake UI inside it, if a
// grammar copied it through unescaped.
const PAYLOAD = `</code></pre></span><form action="https://evil.test"><input name='senha'></form>`
  + `<a href="https://evil.test">entrar</a><img src=x onerror=alert(1)> & &amp; &lt; < > " '`;

// The payload inside the strings and comments of every supported syntax, plus
// bare, so each grammar sees it in the states where it copies text through.
const SNIPPETS = [
  PAYLOAD,
  `"${PAYLOAD}"`,
  `'${PAYLOAD}'`,
  `\`${PAYLOAD} \${x}\``,
  `x = "${PAYLOAD}"`,
  `// ${PAYLOAD}`,
  `/* ${PAYLOAD} */`,
  `# ${PAYLOAD}`,
  `-- ${PAYLOAD}`,
  `<!-- ${PAYLOAD} -->`,
  `<div title="${PAYLOAD}">${PAYLOAD}</div>`,
  `<script>let s = "${PAYLOAD}";</script><style>a { content: "${PAYLOAD}" }</style>`,
  `r#"${PAYLOAD}"#`,
  `"""${PAYLOAD}"""`,
  `echo "${PAYLOAD}" <<EOF\n${PAYLOAD}\nEOF`,
  `key: "${PAYLOAD}"\nother: ${PAYLOAD}`,
  `[table]\nkey = '${PAYLOAD}'`,
  `\`${PAYLOAD}\`\n\n\`\`\`html\n${PAYLOAD}\n\`\`\``,
  `+ ${PAYLOAD}\n- ${PAYLOAD}\n@@ ${PAYLOAD} @@`,
];

const ALLOWED_ELEMENTS = new Set(['PRE', 'CODE', 'SPAN']);

function parse(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** The elements in `html` other than the highlighter's own markup. */
function unexpectedElements(html: string): string[] {
  return [...parse(html).querySelectorAll('*')]
    .filter((el) => !ALLOWED_ELEMENTS.has(el.tagName) || [...el.attributes].some((attr) => attr.name !== 'class'))
    .map((el) => el.outerHTML.slice(0, 80));
}

describe('highlightCode', () => {
  it('wraps tokens of a supported language in the themed markup', async () => {
    const html = await highlightCode('const tema = "preto";', 'typescript');
    expect(html).toContain('class="twinkleplop"');
    expect(html).toContain('<span class="tok keyword">const</span>');
  });

  it.each([...Object.keys(GRAMMARS), ...Object.keys(ALIASES)])(
    'escapes markup in strings and comments for %s',
    async (language) => {
      for (const snippet of SNIPPETS) {
        const html = await highlightCode(snippet, language);
        expect(html, snippet).not.toBeNull();
        expect(unexpectedElements(html!), snippet).toEqual([]);
        expect(parse(html!).textContent, snippet).toBe(snippet);
      }
    },
  );

  it('accepts only its own pre, code and span tags with a class', () => {
    expect(isHighlighterMarkup('<pre class="twinkleplop"><code><span class="tok tag_name">a</span> &lt;b&gt;</code></pre>')).toBe(true);
    expect(isHighlighterMarkup('<pre><code>a > b</code></pre>')).toBe(true);
    for (const html of [
      '<pre><code></code></pre><form>',
      '<span class="a" onclick="x">',
      '<span title="x">',
      '<span class="a"b">',
      '<a href="x">',
      '<span class="x"><img src=x',
      '<span <img src=x>',
    ]) {
      expect(isHighlighterMarkup(html), html).toBe(false);
    }
  });

  it('resolves common names and file-extension ids onto a grammar', async () => {
    for (const name of ['js', 'JSON', 'jsonc', 'jsx', 'py', 'sh', 'yml', 'rs', 'md', 'xml', 'vue']) {
      expect(await highlightCode('a', name), name).toContain('class="twinkleplop"');
    }
  });

  it('highlights JSON values through the JavaScript grammar', async () => {
    const html = await highlightCode('{ "ok": true, "n": 12 }', 'json');
    expect(html).toContain('<span class="tok boolean">true</span>');
    expect(html).toContain('<span class="tok number">12</span>');
  });

  it('drops the final newline so it does not render as an empty last line', async () => {
    const html = await highlightCode('let a = 1\n', 'js');
    expect(html).not.toContain('<span class="l"></span>');
  });

  it('returns null for plain text, no language, and languages without a grammar', async () => {
    expect(await highlightCode('x', null)).toBeNull();
    expect(await highlightCode('x', 'text')).toBeNull();
    expect(await highlightCode('x', 'java')).toBeNull();
    // aliased wrongly by the CSS/TOML grammars, so deliberately left plain
    expect(await highlightCode('$c: red;', 'scss')).toBeNull();
    expect(await highlightCode('; c', 'ini')).toBeNull();
  });

  it('does not treat inherited object keys as languages', async () => {
    expect(await highlightCode('x', 'constructor')).toBeNull();
    expect(await highlightCode('x', '__proto__')).toBeNull();
  });
});
