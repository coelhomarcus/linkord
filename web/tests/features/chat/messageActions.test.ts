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
    expect(messagePermissions(webhookMessage, { userId: 'eu', role: 'user' }, { type: 'text', permissions: readOnly })).toMatchObject({ reply: false, react: true, delete: false, report: false });
    expect(messagePermissions(webhookMessage, { userId: 'mod', role: 'user' }, { type: 'text', permissions: moderator })).toMatchObject({ reply: true, delete: true });
    expect(messagePermissions(msg(), { userId: 'eu', role: 'user' }, { type: 'text', permissions: PERMISSIONS.VIEW_CHANNEL }).react).toBe(false);
  });

  it('own message: can edit and delete, cannot report', () => {
    expect(messagePermissions(msg(), { userId: 'autor', role: 'user' })).toEqual({ react: true, reply: true, copy: true, edit: true, delete: true, report: false, removeAttachment: true, removeEmbed: true });
  });

  it("someone else's message: can report, cannot edit or delete", () => {
    expect(messagePermissions(msg(), { userId: 'eu', role: 'user' })).toMatchObject({ edit: false, delete: false, report: true });
  });

  it("admin deletes someone else's message, but cannot edit", () => {
    expect(messagePermissions(msg(), { userId: 'adm', role: 'admin' })).toMatchObject({ edit: false, delete: true });
  });

  it('invitation card: no react, reply, edit or report', () => {
    expect(messagePermissions(msg({ kind: 'server_invite', text: '' }), { userId: 'autor', role: 'user' })).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false, removeAttachment: false, removeEmbed: false });
  });

  it('dm call line: nothing, including delete', () => {
    expect(messagePermissions(msg({ kind: 'dm_call', text: '', callDurationSeconds: null }), { userId: 'autor', role: 'admin' })).toEqual({ react: false, reply: false, copy: false, edit: false, delete: false, report: false, removeAttachment: false, removeEmbed: false });
  });

  it('call invite card: no react, reply, edit or report, but its author may delete it', () => {
    expect(messagePermissions(msg({ kind: 'call_invite', text: '' }), { userId: 'autor', role: 'user' })).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false, removeAttachment: false, removeEmbed: false });
  });

  it('removing an attachment: only while the message keeps something else, by its author or an admin', () => {
    const photo = { id: 'f1', name: 'f1.png', mime: 'image/png', size: 1 };
    expect(messagePermissions(msg({ text: '', attachments: [photo] }), { userId: 'autor', role: 'user' }).removeAttachment).toBe(false);
    expect(messagePermissions(msg({ text: '', attachments: [photo, { ...photo, id: 'f2' }] }), { userId: 'autor', role: 'user' }).removeAttachment).toBe(true);
    expect(messagePermissions(msg({ attachments: [photo] }), { userId: 'eu', role: 'user' }).removeAttachment).toBe(false);
    expect(messagePermissions(msg({ attachments: [photo] }), { userId: 'adm', role: 'admin' }).removeAttachment).toBe(true);
  });

  it('removing a link card: only its author, not an admin', () => {
    expect(messagePermissions(msg(), { userId: 'autor', role: 'user' }).removeEmbed).toBe(true);
    expect(messagePermissions(msg(), { userId: 'adm', role: 'admin' }).removeEmbed).toBe(false);
  });

  it('deleted author: no one to report', () => {
    expect(messagePermissions(msg({ id: null }), { userId: 'eu', role: 'user' }).report).toBe(false);
  });
});
