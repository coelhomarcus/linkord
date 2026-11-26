import { expect, it } from 'vitest';
import en from '@/features/admin/locales/en-US.json';
import pt from '@/features/admin/locales/pt-BR.json';

function translationKeys(catalog: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const name = prefix + key;
    if (typeof value === 'string') {
      return [name + ':' + [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((entry) => entry[1]).sort().join(',')];
    }
    return translationKeys(value as Record<string, unknown>, name + '.');
  });
}

it('keeps administrative translations and their variables in sync', () => {
  expect(translationKeys(en).sort()).toEqual(translationKeys(pt).sort());
});
