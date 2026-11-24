import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playgroundChatFrom } from '../../../src/modules/servers/playgroundChat.js';

const channels = [{ id: 'geral', type: 'text' as const }, { id: 'voz', type: 'voice' as const }];
const playground = { voiceMode: 'playground' };

describe('playgroundChatFrom', () => {
  it('takes a text channel of the server, or null to unset', () => {
    assert.equal(playgroundChatFrom(channels, playground, 'geral'), 'geral');
    assert.equal(playgroundChatFrom(channels, playground, null), null);
  });

  it('refuses a voice channel, a channel from elsewhere and anything that is not an id', () => {
    assert.equal(playgroundChatFrom(channels, playground, 'voz'), 'invalid');
    assert.equal(playgroundChatFrom(channels, playground, 'another-server'), 'invalid');
    assert.equal(playgroundChatFrom(channels, playground, 42), 'invalid');
  });

  it('gives a game chat only to a playground', () => {
    assert.equal(playgroundChatFrom(channels, { voiceMode: 'standard' }, 'geral'), 'invalid');
    assert.equal(playgroundChatFrom(channels, { voiceMode: 'standard' }, null), null);
  });
});
