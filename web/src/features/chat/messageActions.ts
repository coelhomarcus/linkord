import type { ChatMessage, Conversation } from '@/shared/types/protocol';

export interface MessagePermissions {
  react: boolean;
  reply: boolean;
  copy: boolean;
  edit: boolean;
  delete: boolean;
  report: boolean;
  /** taking one attachment out, while the message keeps something else */
  removeAttachment: boolean;
}

/** What the viewer may do with a message — one answer for the hover
 * toolbar, the phone menu and the right-click menu, so they can't drift.
 * The server checks again; this only decides what to offer. */
export function messagePermissions(
  message: ChatMessage,
  me: { userId: string | null; role: string },
  conversation?: Pick<Conversation, 'type' | 'myRole'> | null,
): MessagePermissions {
  const isInvite = message.kind === 'group_invite';
  const isMine = !!me.userId && message.id === me.userId;
  // a bot takes no replies (nobody writes in it), and whoever owns it tidies it up
  const inBot = conversation?.type === 'bot';
  return {
    react: !isInvite,
    reply: !isInvite && !inBot,
    copy: !!message.text,
    edit: isMine && !isInvite,
    delete: isMine || me.role === 'admin' || (inBot && conversation?.myRole === 'owner'),
    report: !isMine && !isInvite && !!message.id,
    // taking the only thing a message has is deleting it; an admin may take
    // anyone's attachment out
    removeAttachment: (isMine || me.role === 'admin') && !isInvite
      && (!!message.text.trim() || (message.attachments?.length ?? 0) > 1),
  };
}
