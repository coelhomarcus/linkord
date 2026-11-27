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
  /** pinning it to the conversation for everyone (or unpinning it) */
  pin: boolean;
  /** keeping it in the viewer's own saved messages */
  save: boolean;
}

/** What the viewer may do with a message — one answer for the hover
 * toolbar, the phone menu and the right-click menu, so they can't drift.
 * The server checks again; this only decides what to offer. */
export function messagePermissions(
  message: ChatMessage,
  userId: string | null,
  conversation?: Pick<Conversation, 'type' | 'permissions'> | null,
): MessagePermissions {
  const isCallLog = message.kind === 'dm_call';
  const isNotice = message.kind === 'pin_notice';
  const isInvite = message.kind === 'server_invite' || message.kind === 'call_invite' || isCallLog || isNotice;
  const isMine = !!userId && message.id === userId;
  // in a channel the server's roles decide; a DM leaves the friendship gate to the server
  const channel = conversation?.permissions;
  const may = (bit: number) => channel === undefined || hasPermission(channel, bit);
  return {
    react: !isInvite && may(PERMISSIONS.ADD_REACTIONS),
    reply: !isInvite && may(PERMISSIONS.SEND_MESSAGES),
    copy: !!message.text,
    // a sticker is the whole message: nothing to edit; and whoever may no
    // longer send here may not rewrite either (the server refuses both)
    edit: isMine && !isInvite && message.sticker === undefined && may(PERMISSIONS.SEND_MESSAGES),
    // a pin notice is the pinner's to take back, like a message of theirs
    delete: !isCallLog && (isMine || (channel !== undefined && hasPermission(channel, PERMISSIONS.MANAGE_MESSAGES))),
    report: !isMine && !isInvite && !!message.id,
    // An attachment-only message must keep at least one attachment.
    removeAttachment: isMine && !isInvite
      && (!!message.text.trim() || (message.attachments?.length ?? 0) > 1),
    removeEmbed: isMine && !isInvite,
    // only a message: a card or a notice has nothing to come back to.
    // A DM leaves the friendship gate to the server, as replies do.
    pin: !isInvite && may(PERMISSIONS.PIN_MESSAGES),
    save: !isInvite,
  };
}
