import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chatNoticeText, friendAcceptedNoticeText, friendRequestNoticeText, handleLine, mentionNoticeText, previewText, pushAvatarPath,
  serverInvitationNoticeText, type ChatNoticeInput,
} from '../../../src/modules/notifications/pushNotices.js';

const chat: ChatNoticeInput = {
  direct: false, name: 'Ana', text: 'oi', channelTitle: 'geral', serverName: 'Equipe', kind: 'text', callDurationSeconds: null, invitedChannel: null,
};

describe('chat push text', () => {
  it('names the sender once in a DM, in the title', () => {
    assert.deepEqual(chatNoticeText({ ...chat, direct: true, text: 'oi, tudo bem?' }, 'pt-BR'), { title: 'Ana', body: 'oi, tudo bem?' });
    assert.deepEqual(chatNoticeText({ ...chat, direct: true, text: '' }, 'en-US'), { title: 'Ana', body: 'Sent a message' });
  });

  it('keeps the author in the body of a channel message, where several people write', () => {
    assert.deepEqual(chatNoticeText(chat, 'pt-BR'), { title: '#geral · Equipe', body: 'Ana: oi' });
    assert.equal(chatNoticeText({ ...chat, text: '' }, 'pt-BR').body, 'Ana enviou uma mensagem');
  });

  it('says a sticker was sent instead of an empty message', () => {
    assert.equal(chatNoticeText({ ...chat, text: '', sticker: true }, 'pt-BR').body, 'Ana enviou uma figurinha');
    assert.deepEqual(chatNoticeText({ ...chat, direct: true, text: '', sticker: true }, 'en-US'), { title: 'Ana', body: 'Sent a sticker' });
  });

  it('describes DM calls without repeating the name', () => {
    const call = { ...chat, direct: true, kind: 'dm_call' };
    assert.deepEqual(chatNoticeText(call, 'pt-BR'), { title: 'Ana', body: 'Iniciou uma chamada' });
    assert.equal(chatNoticeText({ ...call, callDurationSeconds: 720 }, 'pt-BR').body, 'Iniciou uma chamada · 12 minutos');
    assert.equal(chatNoticeText({ ...call, callDurationSeconds: 90 }, 'en-US').body, 'Started a call · 1 minute');
  });

  it('describes a voice channel invitation', () => {
    const invite = { ...chat, kind: 'call_invite', invitedChannel: { name: 'Sala', serverName: 'Equipe' } };
    assert.equal(chatNoticeText({ ...invite, direct: true }, 'en-US').body, 'Invited you to the Sala voice channel in Equipe');
    assert.equal(chatNoticeText(invite, 'en-US').body, 'Ana invited you to the Sala voice channel in Equipe');
  });
});

describe('mention push text', () => {
  it('says who, where and what', () => {
    assert.deepEqual(mentionNoticeText({ direct: false, name: 'Ana', text: 'oi @você', channelTitle: 'geral', serverName: 'Equipe' }, 'pt-BR'),
      { title: 'Ana em #geral · Equipe', body: 'oi @você' });
    assert.deepEqual(mentionNoticeText({ direct: true, name: 'Ana', text: 'oi @você', channelTitle: '', serverName: '' }, 'pt-BR'),
      { title: 'Ana mencionou você', body: 'oi @você' });
  });
});

describe('social push text', () => {
  it('names the person on friend requests and acceptances', () => {
    assert.deepEqual(friendRequestNoticeText({ username: 'ana', displayName: 'Ana Maria' }, 'pt-BR'),
      { title: 'Ana Maria enviou um pedido de amizade', body: '@ana' });
    assert.deepEqual(friendAcceptedNoticeText({ username: 'ana', displayName: '' }, 'en-US'),
      { title: 'ana accepted your friend request', body: '' });
  });

  it('names the server and the inviter on a server invitation', () => {
    assert.deepEqual(serverInvitationNoticeText({ inviterName: 'Ana', serverName: 'Equipe do projeto' }, 'pt-BR'),
      { title: 'Convite para Equipe do projeto', body: 'Ana convidou você' });
  });

  it('skips the handle when it would repeat the name', () => {
    assert.equal(handleLine({ username: 'ana', displayName: 'ana' }), '');
    assert.equal(handleLine({ username: 'ana', displayName: '' }), '');
  });
});

describe('push helpers', () => {
  it('collapses whitespace and caps the preview', () => {
    assert.equal(previewText('  a\n\n b  '), 'a b');
    assert.equal(previewText('x'.repeat(300)).length, 120);
  });

  it('shows a role mention by the role name, and a deleted role as such', () => {
    const role = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
    const gone = '00000000-0000-4000-8000-000000000000';
    const names = (id: string) => (id === role ? 'Moderação' : undefined);
    assert.equal(previewText(`<@&${role}> e <@&${gone}>`, names), '@Moderação e @cargo-excluído');
    assert.equal(previewText(`<@&${gone}>`, names, 'en-US'), '@deleted-role');
  });

  it('uses only our own uploaded avatars, preferring the still frame', () => {
    const id = 'a'.repeat(32);
    assert.equal(pushAvatarPath({ avatar: `/uploads/${id}`, avatarPoster: '' }), `/uploads/${id}`);
    assert.equal(pushAvatarPath({ avatar: `/uploads/${id}`, avatarPoster: `/uploads/${'b'.repeat(32)}` }), `/uploads/${'b'.repeat(32)}`);
    assert.equal(pushAvatarPath({ avatar: 'https://example.com/a.png', avatarPoster: '' }), undefined);
    assert.equal(pushAvatarPath(null), undefined);
  });
});
