import type { ChatMessage } from '@/shared/types/protocol';
import { gifMessageUrl } from '@/features/gifs/klipyMedia';

/** One-line text for a message wherever the body itself can't be shown
 * (sidebar subtitle, desktop notification). Invite cards have an empty
 * `text`, so without this they would read as an attachment. */
export function messagePreviewText(message: Pick<ChatMessage, 'text' | 'kind' | 'invitation' | 'richEmbeds'>): string {
  if (message.kind === 'group_invite') {
    return message.invitation ? `Convite para o grupo ${message.invitation.groupTitle}` : 'Convite indisponível';
  }
  if (gifMessageUrl(message.text)) return 'GIF';
  // a bot may send only a card: its title says what it's about
  const card = message.richEmbeds?.[0];
  return message.text || card?.title || card?.description || (card ? 'Aviso' : 'Anexo');
}
