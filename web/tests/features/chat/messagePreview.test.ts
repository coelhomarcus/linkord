import { describe, expect, it } from 'vitest';
import { messagePreviewText } from '@/features/chat/messagePreview';

describe('messagePreviewText', () => {
  it('uses the text when it exists', () => expect(messagePreviewText({ text: 'oi' })).toBe('oi'));
  it('falls back to "Anexo" for empty text', () => expect(messagePreviewText({ text: '' })).toBe('Anexo'));
  it('a voice message without a caption reads as one', () => {
    expect(messagePreviewText({ text: '', attachments: [{ id: 'a', name: 'v.webm', mime: 'audio/webm', size: 1, voice: { durationMs: 1000, waveform: 'AA==' } }] })).toBe('🎤 Mensagem de voz');
  });
  it('a sticker reads as its name, or as a sticker once it was deleted', () => {
    expect(messagePreviewText({ text: '', sticker: { id: 'x', name: 'abraço', description: '', animated: false } })).toBe('Figurinha: abraço');
    expect(messagePreviewText({ text: '', sticker: null })).toBe('Figurinha');
  });
  it('a GIF message reads as "GIF", not as its URL', () => expect(messagePreviewText({ text: 'https://static.klipy.com/ii/abc/md.webp' })).toBe('GIF'));
  it('names the server in an invitation', () => {
    expect(messagePreviewText({ text: '', kind: 'server_invite', invitation: { serverName: 'Squad' } as never })).toBe('Convite para o servidor Squad');
  });
  it("a bot's card-only message reads as the card's title, never as an attachment", () => {
    expect(messagePreviewText({ text: '', richEmbeds: [{ title: 'CPU alta' }] })).toBe('CPU alta');
    expect(messagePreviewText({ text: '', richEmbeds: [{ fields: [{ name: 'a', value: 'b', inline: false }] }] })).toBe('Aviso');
  });
  it('names the voice channel a call invite points at', () => {
    expect(messagePreviewText({ text: '', kind: 'call_invite', callInvite: { channelId: 'g1', channelName: 'Geral', serverId: 's', serverName: 'Squad', serverIcon: '' } })).toBe('Convite para o canal de voz Geral');
    expect(messagePreviewText({ text: '', kind: 'call_invite', callInvite: null })).toBe('Convite para chamada indisponível');
  });
  it('a dm call line uses the viewer sentence', () => {
    expect(messagePreviewText({ text: '', kind: 'dm_call', id: 'a', name: 'Marcus', callDurationSeconds: 90 }, 'b')).toBe('Marcus iniciou uma chamada que durou 1 minuto.');
    expect(messagePreviewText({ text: '', kind: 'dm_call', id: 'a', name: 'Marcus', callDurationSeconds: null }, 'a')).toBe('Você iniciou uma chamada.');
  });

  it('an invitation with no server is "indisponível", never "Anexo"', () => {
    expect(messagePreviewText({ text: '', kind: 'server_invite', invitation: null })).toBe('Convite indisponível');
  });
});

describe('messagePreviewText — role mentions', () => {
  const ROLE = '11111111-1111-4111-8111-111111111111';
  const servers = [{ roles: [{ id: ROLE, name: 'Moderação', color: '', position: 1, permissions: 0, hoist: false, mentionable: true, isDefault: false }] }];

  it('names the role from any of the reader\'s servers, or says it was deleted', () => {
    expect(messagePreviewText({ text: `<@&${ROLE}> ajuda` }, null, servers)).toBe('@Moderação ajuda');
    expect(messagePreviewText({ text: `<@&${ROLE}> ajuda` }, null, [])).toBe('@cargo-excluído ajuda');
  });
});

