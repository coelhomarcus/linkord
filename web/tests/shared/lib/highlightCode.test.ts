import { describe, expect, it } from 'vitest';
import { highlightCode } from '@/shared/lib/highlightCode';

describe('highlightCode', () => {
  it('wraps tokens of a supported language in the themed markup', async () => {
    const html = await highlightCode('const tema = "preto";', 'typescript');
    expect(html).toContain('class="twinkleplop"');
    expect(html).toContain('<span class="tok keyword">const</span>');
  });

  it('escapes the source so a snippet can never inject markup', async () => {
    const html = await highlightCode('const x = "<img src=x onerror=alert(1)>";', 'ts');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
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
