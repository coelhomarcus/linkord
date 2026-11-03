import { SpeakerHighIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import type { Conversation, Participant } from '@/shared/types/protocol';

interface ActiveCall { conversation: Conversation; friends: Participant[] }

/** Discord's "Ativo agora": the voice calls your friends are in right now,
 * one card per call, each a click away from joining. */
export function ActiveNowPanel() {
  const { t } = useTranslation('friends');
  const { state, conversations, servers, friendUserIds, openCall } = useRoom();

  const calls = useMemo(() => {
    const byConversation = new Map<string, ActiveCall>();
    for (const participant of state.participants.values()) {
      const conversationId = participant.callConversationId;
      if (!conversationId || !friendUserIds.has(participant.userId)) continue;
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation) continue;
      const entry = byConversation.get(conversationId) ?? { conversation, friends: [] };
      if (!entry.friends.some((f) => f.userId === participant.userId)) entry.friends.push(participant);
      byConversation.set(conversationId, entry);
    }
    return [...byConversation.values()].sort((a, b) => b.friends.length - a.friends.length);
  }, [state.participants, conversations, friendUserIds]);

  return (
    <aside aria-label={t('activeNow.title')} className="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-border-subtle px-4 py-5">
      <h2 className="mb-4 text-title font-bold text-text-primary">{t('activeNow.title')}</h2>
      {calls.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-body font-semibold text-text-primary">{t('activeNow.emptyTitle')}</p>
          <p className="mt-1 text-label text-text-muted">{t('activeNow.emptyText')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {calls.map(({ conversation, friends }) => {
            const server = conversation.serverId ? servers.find((s) => s.id === conversation.serverId) : null;
            const lead = friends[0]!;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => openCall(conversation.id)}
                  className="w-full rounded-lg border border-border-subtle bg-bg-secondary p-3 text-left transition-colors hover:bg-bg-hover"
                >
                  <span className="flex items-center gap-3">
                    <Avatar id={lead.userId} name={lead.displayName} avatar={lead.avatar} poster={lead.avatarPoster} avatarColor={lead.avatarColor} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label font-semibold text-text-primary">
                        {friends.length > 1 ? t('activeNow.names', { name: lead.displayName, count: friends.length - 1 }) : lead.displayName}
                      </span>
                      <span className="block truncate text-caption text-text-muted">
                        {server ? t('activeNow.inChannel', { channel: conversation.title, server: server.name }) : t('activeNow.inDirectCall')}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 rounded-md bg-fill-subtle px-2 py-1.5 text-caption text-text-secondary">
                    <SpeakerHighIcon size={16} weight="fill" className="flex-none text-green" />
                    <span className="flex -space-x-1.5">
                      {friends.slice(0, 5).map((friend) => (
                        <Avatar key={friend.userId} id={friend.userId} name={friend.displayName} avatar={friend.avatar} poster={friend.avatarPoster} avatarColor={friend.avatarColor} size={20} className="ring-2 ring-bg-secondary" />
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
