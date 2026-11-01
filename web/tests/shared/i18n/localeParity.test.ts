import { describe, expect, it } from 'vitest';
import { LANGUAGES, DEFAULT_LANGUAGE } from '@/shared/i18n/languages';

type Bundle = Record<string, unknown>;

const files = import.meta.glob<Bundle>(
  ['/src/shared/i18n/locales/*.json', '/src/features/*/locales/*.json'],
  { eager: true, import: 'default' },
);

/** `a.b.c` for every string leaf. */
function flatten(bundle: Bundle, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') Object.assign(out, flatten(value as Bundle, path));
    else out[path] = String(value);
  }
  return out;
}

const variables = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]!).sort();

// Plural suffixes legitimately differ per language (en: one/other, pt: one/many/other).
const baseKey = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');

const byNamespace = new Map<string, Map<string, Bundle>>();
for (const [path, bundle] of Object.entries(files)) {
  const match = /^\/src\/(?:shared\/i18n|features\/([^/]+))\/locales\/([^/]+)\.json$/.exec(path)!;
  const namespace = match[1] ?? 'common';
  if (!byNamespace.has(namespace)) byNamespace.set(namespace, new Map());
  byNamespace.get(namespace)!.set(match[2]!, bundle);
}

describe('locale files', () => {
  it.each([...byNamespace.entries()])('namespace "%s" has a file for every language', (_namespace, languages) => {
    expect([...languages.keys()].sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  describe.each([...byNamespace.entries()])('namespace "%s"', (_namespace, languages) => {
    const source = flatten(languages.get(DEFAULT_LANGUAGE)!);
    const sourceKeys = [...new Set(Object.keys(source).map(baseKey))].sort();

    it.each(LANGUAGES.filter((l) => l.code !== DEFAULT_LANGUAGE).map((l) => l.code))('%s has exactly the keys of the source language', (code) => {
      const translated = flatten(languages.get(code)!);
      expect([...new Set(Object.keys(translated).map(baseKey))].sort()).toEqual(sourceKeys);
    });

    it.each(LANGUAGES.filter((l) => l.code !== DEFAULT_LANGUAGE).map((l) => l.code))('%s uses the same {{variables}} as the source language', (code) => {
      const translated = flatten(languages.get(code)!);
      for (const [key, text] of Object.entries(translated)) {
        const counterpart = source[key] ?? source[`${baseKey(key)}_other`] ?? source[baseKey(key)];
        if (counterpart !== undefined) expect(variables(text), key).toEqual(variables(counterpart));
      }
    });
  });
});
