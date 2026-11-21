import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  applyPreferenceChanges, cleanStoredPreferences, MAX_CHANGES, parsePreferenceChanges, PREFERENCE_KINDS, PREFERENCE_PREFIXES,
} from '../../../src/modules/users/preferencesPolicy.js';

const WEB_KINDS = path.resolve(import.meta.dirname, '../../../../web/src/shared/preferences/preferenceKinds.ts');

function webRecord(source: string, name: string): Record<string, string> {
  const body = new RegExp(`export const ${name} = \\{([^}]*)\\}`).exec(source)?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/'?([\w.:]+)'?: '(\w+)'/g)].map((m) => [m[1], m[2]]));
}

describe('preferencesPolicy', () => {
  it('lists the same keys and kinds as the web app', () => {
    const source = fs.readFileSync(WEB_KINDS, 'utf8');
    assert.deepEqual(webRecord(source, 'PREFERENCE_KINDS'), PREFERENCE_KINDS);
    assert.deepEqual(webRecord(source, 'PREFERENCE_PREFIXES'), PREFERENCE_PREFIXES);
  });

  it('accepts values of the right shape and null to clear', () => {
    const changes = {
      colorTheme: 'mocha', timeFormat: '24h', 'sounds.call': false, emojiSkinTone: 3,
      'callVolume:user-1': 0.4, 'callVolume:user-1:screen': 0, 'collapsed:server_1': ['cat-a', 'cat-b'], font: null,
    };
    assert.deepEqual(parsePreferenceChanges(changes), changes);
  });

  it('refuses unknown keys, wrong shapes and out of range values', () => {
    for (const body of [
      { theme: 'black' },
      { colorTheme: 'Black Theme' },
      { 'sounds.call': 'false' },
      { emojiSkinTone: 6 },
      { emojiSkinTone: 1.5 },
      { 'callVolume:u': 1.5 },
      { 'callVolume:u': Number.NaN },
      { 'callVolume:u:camera': 0.5 },
      { 'callVolume:': 0.5 },
      { 'collapsed:s': [] },
      { 'collapsed:s': ['a b'] },
      { 'collapsed:s': 'a' },
      { constructor: true },
      ['colorTheme'],
      null,
      'colorTheme',
    ]) {
      assert.equal(parsePreferenceChanges(body), null, JSON.stringify(body));
    }
  });

  it('refuses null in a seed', () => {
    assert.equal(parsePreferenceChanges({ font: null }, { allowNull: false }), null);
  });

  it('refuses more changes than an account can hold', () => {
    const body = Object.fromEntries(Array.from({ length: MAX_CHANGES + 1 }, (_, i) => [`callVolume:u${i}`, 0.5]));
    assert.equal(parsePreferenceChanges(body), null);
  });

  it('merges per key and deletes cleared ones', () => {
    assert.deepEqual(
      applyPreferenceChanges({ colorTheme: 'mocha', 'callVolume:a': 0.2 }, { 'callVolume:b': 0.7, colorTheme: null }),
      { 'callVolume:a': 0.2, 'callVolume:b': 0.7 },
    );
  });

  it('refuses a map past its limit', () => {
    const current = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`collapsed:s${i}`, ['c']]));
    assert.equal(applyPreferenceChanges(current, { 'collapsed:extra': ['c'] }), 'too_many');
    assert.notEqual(applyPreferenceChanges(current, { 'collapsed:s0': ['d'] }), 'too_many');
  });

  it('drops what a stored row holds that this build does not accept', () => {
    assert.deepEqual(cleanStoredPreferences({ colorTheme: 'black', removed: true, emojiSkinTone: 'x' }), { colorTheme: 'black' });
    assert.deepEqual(cleanStoredPreferences(null), {});
    assert.deepEqual(cleanStoredPreferences([1]), {});
  });
});
