import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../../src/config/env.js';
import { playgroundsEnabled, shownVoiceMode } from '../../../src/modules/servers/serverAccess.js';

describe('shownVoiceMode', () => {
  const saved = config.PLAYGROUND_URL;
  afterEach(() => { config.PLAYGROUND_URL = saved; });

  test('a playground is one while the playground service is on', () => {
    config.PLAYGROUND_URL = 'https://chat.example.com';
    assert.equal(playgroundsEnabled(), true);
    assert.equal(shownVoiceMode('playground'), 'playground');
    assert.equal(shownVoiceMode('standard'), 'standard');
  });

  test('and an ordinary voice channel while it is off', () => {
    config.PLAYGROUND_URL = '';
    assert.equal(playgroundsEnabled(), false);
    assert.equal(shownVoiceMode('playground'), 'standard');
    assert.equal(shownVoiceMode('anything'), 'standard');
  });
});
