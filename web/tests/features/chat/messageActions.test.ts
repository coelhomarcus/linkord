import { describe, expect, it } from 'vitest';
import { messagePermissions } from '@/features/chat/messageActions';
import type { ChatMessage } from '@/shared/types/protocol';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ msgId: 1, conversationId: 'c', id: 'autor', name: 'A', avatar: '', text: 'oi', ts: 1, ...over });

describe('messagePermissions', () => {
  it("in a bot: nobody replies, and its owner deletes what it posted", () => {
    const botMessage = msg({ id: null, bot: true });
    expect(messagePermissions(botMessage, { userId: 'dono', role: 'user' }, { type: 'bot', myRole: 'owner' })).toMatchObject({ reply: false, react: true, delete: true, report: false });
    expect(messagePermissions(botMessage, { userId: 'eu', role: 'user' }, { type: 'bot', myRole: 'member' })).toMatchObject({ reply: false, delete: false });
    expect(messagePermissions(msg(), { userId: 'dono', role: 'user' }, { type: 'group', myRole: 'owner' }).delete).toBe(false);
  });

  it('own message: can edit and delete, cannot report', () => {
    expect(messagePermissions(msg(), { userId: 'autor', role: 'user' })).toEqual({ react: true, reply: true, copy: true, edit: true, delete: true, report: false, removeAttachment: true });
  });

  it("someone else's message: can report, cannot edit or delete", () => {
    expect(messagePermissions(msg(), { userId: 'eu', role: 'user' })).toMatchObject({ edit: false, delete: false, report: true });
  });

  it("admin deletes someone else's message, but cannot edit", () => {
    expect(messagePermissions(msg(), { userId: 'adm', role: 'admin' })).toMatchObject({ edit: false, delete: true });
  });

  it('invitation card: no react, reply, edit or report', () => {
    expect(messagePermissions(msg({ kind: 'group_invite', text: '' }), { userId: 'autor', role: 'user' })).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false, removeAttachment: false });
  });

  it('removing an attachment: only while the message keeps something else, by its author or an admin', () => {
    const photo = { id: 'f1', name: 'f1.png', mime: 'image/png', size: 1 };
    expect(messagePermissions(msg({ text: '', attachments: [photo] }), { userId: 'autor', role: 'user' }).removeAttachment).toBe(false);
    expect(messagePermissions(msg({ text: '', attachments: [photo, { ...photo, id: 'f2' }] }), { userId: 'autor', role: 'user' }).removeAttachment).toBe(true);
    expect(messagePermissions(msg({ attachments: [photo] }), { userId: 'eu', role: 'user' }).removeAttachment).toBe(false);
    expect(messagePermissions(msg({ attachments: [photo] }), { userId: 'adm', role: 'admin' }).removeAttachment).toBe(true);
  });

  it('deleted author: no one to report', () => {
    expect(messagePermissions(msg({ id: null }), { userId: 'eu', role: 'user' }).report).toBe(false);
  });
});
