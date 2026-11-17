import { SpeakerHighIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { EmptyState } from '@/shared/ui/empty-state';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { useCallRoster } from '@/features/calls/callRoster';
import type { RosterParticipant } from '@/features/calls/callRoster';
import type { Activity, Conversation, Participant, PublicUser } from '@/shared/types/protocol';
import { ActivityIcon, ActivityTimer } from '@/features/activity/ActivityLine';
import { cn } from '@/shared/lib/utils';

interface ActiveCall { conversation: Conversation; friends: RosterParticipant[] }

type CallMember = Pick<Participant, 'userId' | 'displayName' | 'avatar' | 'avatarPoster' | 'avatarColor'>;

/** Discord's "Ativo agora": the voice calls your friends are in right now,
 * one card per call, each a click away from joining. */
export function ActiveNowPanel() {
  const { t } = useTranslation('friends');
  const { t: tActivity } = useTranslation('activity');
  const { conversations, servers, friendUserIds, openCall, activeCallConversationId, presenceByUser, onlineUserIds, allUsers } = useRoom('conversations', 'servers', 'friendUserIds', 'openCall', 'activeCallConversationId', 'presenceByUser', 'onlineUserIds', 'allUsers');
  const { me } = useRoomState('me');
  const roster = useCallRoster();

  // friends playing or using something, longest first, as in Discord
  const playing = useMemo(() => {
    const list: { user: PublicUser; activity: Activity }[] = [];
    for (const userId of friendUserIds) {
      const activity = onlineUserIds.has(userId) ? presenceByUser.get(userId)?.activity : null;
      const user = allUsers.get(userId);
      if (activity && user) list.push({ user, activity });
    }
    return list.sort((a, b) => Date.parse(a.activity.startedAt) - Date.parse(b.activity.startedAt));
  }, [friendUserIds, onlineUserIds, presenceByUser, allUsers]);

  const calls = useMemo(() => {
    const byConversation = new Map<string, ActiveCall>();
    for (const participant of roster.values()) {
      const conversationId = participant.callConversationId;
      if (!conversationId || !friendUserIds.has(participant.userId)) continue;
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation) continue;
      const entry = byConversation.get(conversationId) ?? { conversation, friends: [] };
      if (!entry.friends.some((f) => f.userId === participant.userId)) entry.friends.push(participant);
      byConversation.set(conversationId, entry);
    }
    return [...byConversation.values()].sort((a, b) => b.friends.length - a.friends.length);
  }, [roster, conversations, friendUserIds]);

  // Everyone in the call, not only friends: whoever else is there, and you
  // when you are in it too (you are not among the participants)
  const members = useMemo(() => {
    const byConversation = new Map<string, CallMember[]>();
    const add = (conversationId: string, member: CallMember) => {
      const list = byConversation.get(conversationId) ?? [];
      if (!list.some((m) => m.userId === member.userId)) list.push(member);
      byConversation.set(conversationId, list);
    };
    for (const { conversation, friends } of calls) friends.forEach((friend) => add(conversation.id, friend));
    for (const participant of roster.values()) {
      if (participant.callConversationId && byConversation.has(participant.callConversationId)) add(participant.callConversationId, participant);
    }
    if (activeCallConversationId && byConversation.has(activeCallConversationId) && me.userId) {
      add(activeCallConversationId, { userId: me.userId, displayName: me.displayName, avatar: me.avatar, avatarPoster: me.avatarPoster, avatarColor: me.avatarColor });
    }
    return byConversation;
  }, [calls, roster, me, activeCallConversationId]);

  return (
    <aside aria-label={t('activeNow.title')} className="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-border-subtle px-4 py-4">
      <h2 className="mb-4 text-heading font-bold text-text-primary">{t('activeNow.title')}</h2>
      {calls.length === 0 && playing.length === 0 ? (
        <EmptyState size="compact" illustration="speaker" title={t('activeNow.emptyTitle')} description={t('activeNow.emptyText')} />
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
                  className="w-full rounded-[12px] border border-border-subtle bg-surface-app p-4 text-left transition-colors hover:bg-message-hover"
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
                  <span className="mt-3 flex items-center gap-1.5 text-caption text-text-secondary">
                    <SpeakerHighIcon size={16} weight="fill" className="flex-none text-green" />
                    <span className="flex -space-x-1.5">
                      {(members.get(conversation.id) ?? friends).slice(0, 5).map((friend) => (
                        <Avatar key={friend.userId} id={friend.userId} name={friend.displayName} avatar={friend.avatar} poster={friend.avatarPoster} avatarColor={friend.avatarColor} size={20} className="ring-2 ring-surface-app" />
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {playing.length > 0 && (
        <ul className={cn('flex flex-col gap-2', calls.length > 0 && 'mt-2')}>
          {playing.map(({ user, activity }) => (
            <li key={user.id} className="rounded-[12px] border border-border-subtle bg-surface-app p-4">
              <span className="flex items-center gap-3">
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={user.avatarPoster} avatarColor={user.avatarColor} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label font-semibold text-text-primary">{user.displayName}</span>
                  <span className="block truncate text-caption text-text-muted">{tActivity(`line.${activity.kind}`, { name: activity.name })}</span>
                  <ActivityTimer activity={activity} className="mt-0.5" />
                </span>
                <ActivityIcon activity={activity} size={40} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
