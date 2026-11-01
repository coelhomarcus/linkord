import type { PublicUser, ReactionEmoji } from '@/shared/types/protocol';
import { i18n } from '@/shared/i18n/init';

export interface ReactionParticipantsTarget {
  conversationId: string;
  msgId: number;
  /** Preselects a tab when the dialog was opened from a specific chip. */
  emoji?: ReactionEmoji;
}

// missing data isn't proof the account was removed — the user just hasn't
// loaded into allUsers yet
export function reactionParticipantName(userId: string, user: PublicUser | undefined, myUserId: string | null): string {
  if (userId === myUserId) return i18n.t('chat:reactions.you');
  return user?.displayName ?? i18n.t('chat:reactions.fallbackName');
}

export function reactionParticipantNames(userIds: string[], allUsers: Map<string, PublicUser>, myUserId: string | null): string[] {
  return userIds.map((id) => reactionParticipantName(id, allUsers.get(id), myUserId));
}

const MAX_NAMED = 3;

const joinNames = (names: string[]): string => new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(names);

/** "Ana, Bia and 3 more" — compact form for the chip's accessible name. */
export function summarizeReactionParticipants(names: string[]): string {
  if (names.length <= MAX_NAMED) return names.join(', ');
  return i18n.t('chat:reactions.more', { names: names.slice(0, MAX_NAMED).join(', '), count: names.length - MAX_NAMED });
}

/** "Ana, Bia and Caio reacted" / "You reacted" — the hover tooltip's sentence. */
export function reactionSummarySentence(names: string[]): string {
  if (!names.length) return '';
  if (names.length <= MAX_NAMED) return i18n.t('chat:reactions.reacted', { names: joinNames(names), count: names.length });
  return i18n.t('chat:reactions.reactedMore', { names: names.slice(0, MAX_NAMED).join(', '), count: names.length - MAX_NAMED });
}
