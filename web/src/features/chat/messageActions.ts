import type { ChatMessage, Conversation } from '@/shared/types/protocol';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';

export interface MessagePermissions {
  react: boolean;
  reply: boolean;
  copy: boolean;
  edit: boolean;
  delete: boolean;
  report: boolean;
  /** taking one attachment out, while the message keeps something else */
  removeAttachment: boolean;
  /** hiding one link's preview card (the link stays) */
  removeEmbed: boolean;
}

/** What the viewer may do with a message — one answer for the hover
 * toolbar, the phone menu and the right-click menu, so they can't drift.
 * The server checks again; this only decides what to offer. */
export function messagePermissions(
  message: ChatMessage,
  me: { userId: string | null; role: string },
  conversation?: Pick<Conversation, 'type' | 'permissions'> | null,
): MessagePermissions {
  const isCallLog = message.kind === 'dm_call';
  const isInvite = message.kind === 'server_invite' || message.kind === 'call_invite' || isCallLog;
  const isMine = !!me.userId && message.id === me.userId;
  // in a channel the server's roles decide; a DM leaves the friendship gate to the server
  const channel = conversation?.permissions;
  const may = (bit: number) => channel === undefined || hasPermission(channel, bit);
  return {
    react: !isInvite && may(PERMISSIONS.ADD_REACTIONS),
    reply: !isInvite && may(PERMISSIONS.SEND_MESSAGES),
    copy: !!message.text,
    // a sticker is the whole message: nothing to edit (the server refuses too)
    edit: isMine && !isInvite && message.sticker === undefined,
    delete: !isCallLog && (isMine || me.role === 'admin' || (channel !== undefined && hasPermission(channel, PERMISSIONS.MANAGE_MESSAGES))),
    report: !isMine && !isInvite && !!message.id,
    // taking the only thing a message has is deleting it; an admin may take
    // anyone's attachment out
    removeAttachment: (isMine || me.role === 'admin') && !isInvite
      && (!!message.text.trim() || (message.attachments?.length ?? 0) > 1),
    // only the author: an admin may take attachments out, not reshape the text
    removeEmbed: isMine && !isInvite,
  };
}
