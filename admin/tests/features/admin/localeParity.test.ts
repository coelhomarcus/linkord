import { expect, it } from 'vitest';
import { resources } from '@/i18n/init';

function translationKeys(catalog: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const name = prefix + key;
    if (typeof value === 'string') {
      return [name + ':' + [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((entry) => entry[1]).sort().join(',')];
    }
    return translationKeys(value as Record<string, unknown>, name + '.');
  });
}

it('keeps all administrative translations and their variables in sync', () => {
  expect(translationKeys(resources['en-US']).sort()).toEqual(translationKeys(resources['pt-BR']).sort());
});
