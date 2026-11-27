import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_LOCALE, isLocale, LOCALES, resolveLocale } from '../../../src/modules/users/locale.js';
import { localeText } from '../../../src/modules/users/localeText.js';

const FRONTEND_LANGUAGES = {
  web: 'web/src/shared/i18n/languages.ts',
  admin: 'admin/src/i18n/languages.ts',
};

describe('locale', () => {
  for (const [frontend, filename] of Object.entries(FRONTEND_LANGUAGES)) {
    it(`lists the same languages as ${frontend}`, () => {
      const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../', filename), 'utf8');
      const codes = [...source.matchAll(/code: '([^']+)'/g)].map((m) => m[1]);
      assert.deepEqual([...LOCALES], codes);
      assert.equal(DEFAULT_LOCALE, /DEFAULT_LANGUAGE: Language = '([^']+)'/.exec(source)?.[1]);
    });
  }

  it('accepts only supported languages', () => {
    assert.equal(isLocale('en-US'), true);
    assert.equal(isLocale('pt-BR'), true);
    assert.equal(isLocale('en'), false);
    assert.equal(isLocale('xx-XX'), false);
    assert.equal(isLocale(undefined), false);
    assert.equal(isLocale({ toString: () => 'en-US' }), false);
  });

  it('reads anything unsupported as the default', () => {
    assert.equal(resolveLocale('en-US'), 'en-US');
    assert.equal(resolveLocale('fr-FR'), DEFAULT_LOCALE);
    assert.equal(resolveLocale(null), DEFAULT_LOCALE);
    assert.equal(resolveLocale(42), DEFAULT_LOCALE);
  });

  it('renders push and email copy in the recipient locale', () => {
    assert.equal(localeText('pt-BR', 'push.mentionDirectTitle', { name: 'Ana' }), 'Ana mencionou você');
    assert.equal(localeText('en-US', 'push.mentionDirectTitle', { name: 'Ana' }), 'Ana mentioned you');
    assert.match(localeText('en-US', 'email.recoveryAccountLine', { username: 'ana', email: 'ana@example.com' }), /ana@example\.com/);
  });
});
