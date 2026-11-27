import { describe, expect, it } from 'vitest';
import { messagePermissions } from '@/features/chat/messageActions';
import type { ChatMessage } from '@/shared/types/protocol';
import { PERMISSIONS } from '@/features/servers/permissionBits';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ msgId: 1, conversationId: 'c', id: 'autor', name: 'A', avatar: '', text: 'oi', ts: 1, ...over });

describe('messagePermissions', () => {
  it('in a channel: the permissions decide replying, reacting and deleting others', () => {
    const webhookMessage = msg({ id: null, bot: true });
    const readOnly = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.ADD_REACTIONS;
    const moderator = readOnly | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.MANAGE_MESSAGES;
    expect(messagePermissions(webhookMessage, 'eu', { type: 'text', permissions: readOnly })).toMatchObject({ reply: false, react: true, delete: false, report: false });
    expect(messagePermissions(webhookMessage, 'mod', { type: 'text', permissions: moderator })).toMatchObject({ reply: true, delete: true });
    expect(messagePermissions(msg(), 'eu', { type: 'text', permissions: PERMISSIONS.VIEW_CHANNEL }).react).toBe(false);
  });

  it('own message: can edit and delete, cannot report', () => {
    expect(messagePermissions(msg(), 'autor')).toEqual({ react: true, reply: true, copy: true, edit: true, delete: true, report: false, removeAttachment: true, removeEmbed: true, pin: true, save: true });
  });

  it('own sticker: reacted to, replied to and deleted, never edited or copied', () => {
    const sticker = msg({ text: '', sticker: { id: 's', name: 'abraço', description: '', animated: false } });
    expect(messagePermissions(sticker, 'autor')).toMatchObject({ react: true, reply: true, delete: true, edit: false, copy: false });
  });

  it("someone else's message: can report, cannot edit or delete", () => {
    expect(messagePermissions(msg(), 'eu')).toMatchObject({ edit: false, delete: false, report: true });
  });

  it('invitation card: no react, reply, edit or report', () => {
    expect(messagePermissions(msg({ kind: 'server_invite', text: '' }), 'autor')).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false, removeAttachment: false, removeEmbed: false, pin: false, save: false });
  });

  it('dm call line: nothing, including delete', () => {
    expect(messagePermissions(msg({ kind: 'dm_call', text: '', callDurationSeconds: null }), 'autor')).toEqual({ react: false, reply: false, copy: false, edit: false, delete: false, report: false, removeAttachment: false, removeEmbed: false, pin: false, save: false });
  });

  it('call invite card: no react, reply, edit or report, but its author may delete it', () => {
    expect(messagePermissions(msg({ kind: 'call_invite', text: '' }), 'autor')).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false, removeAttachment: false, removeEmbed: false, pin: false, save: false });
  });

  it('removing an attachment: only while the message keeps something else, and only by its author', () => {
    const photo = { id: 'f1', name: 'f1.png', mime: 'image/png', size: 1 };
    expect(messagePermissions(msg({ text: '', attachments: [photo] }), 'autor').removeAttachment).toBe(false);
    expect(messagePermissions(msg({ text: '', attachments: [photo, { ...photo, id: 'f2' }] }), 'autor').removeAttachment).toBe(true);
    expect(messagePermissions(msg({ attachments: [photo] }), 'eu').removeAttachment).toBe(false);
  });

  it('removing a link card: only its author', () => {
    expect(messagePermissions(msg(), 'autor').removeEmbed).toBe(true);
  });

  it('a channel where the author can no longer send: no edit, delete stays', () => {
    const readOnly = { type: 'text' as const, permissions: PERMISSIONS.VIEW_CHANNEL };
    expect(messagePermissions(msg(), 'autor', readOnly)).toMatchObject({ edit: false, delete: true, reply: false });
    const open = { type: 'text' as const, permissions: PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES };
    expect(messagePermissions(msg(), 'autor', open).edit).toBe(true);
  });

  it('pinning: anyone in a DM, PIN_MESSAGES in a channel, never a card or a notice', () => {
    const viewer = 'eu';
    expect(messagePermissions(msg(), viewer).pin).toBe(true);
    expect(messagePermissions(msg(), viewer, { type: 'text', permissions: PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.MANAGE_MESSAGES }).pin).toBe(false);
    expect(messagePermissions(msg(), viewer, { type: 'text', permissions: PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.PIN_MESSAGES }).pin).toBe(true);
    expect(messagePermissions(msg({ kind: 'pin_notice', text: '' }), viewer).pin).toBe(false);
  });

  it('a pin notice: nothing but its pinner deleting it', () => {
    const notice = msg({ kind: 'pin_notice', text: '', pinnedMessageId: 7 });
    expect(messagePermissions(notice, 'autor')).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false, removeAttachment: false, removeEmbed: false, pin: false, save: false });
    expect(messagePermissions(notice, 'eu').delete).toBe(false);
  });

  it('deleted author: no one to report', () => {
    expect(messagePermissions(msg({ id: null }), 'eu').report).toBe(false);
  });
});
