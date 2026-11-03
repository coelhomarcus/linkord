import { SpeakerHighIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { CallInviteCard as CallInvite } from '@/shared/types/protocol';

const SHOWN_PARTICIPANTS = 5;

/** A call to join a group's voice call, sent from inside it. Who's there is
 * read live from presence, so an old card says the call ended instead of
 * inviting into an empty room. */
export function CallInviteCard({ callInvite }: { callInvite: CallInvite | null | undefined }) {
  const { t } = useTranslation('chat');
  const { state, conversations, activeCallConversationId, openCall } = useRoom();
  if (!callInvite) {
    return (
      <div className="mt-1 max-w-[380px] rounded-lg border border-border bg-fill-subtle px-4 py-3 text-label text-text-muted">
        {t('callInvite.unavailable')}
      </div>
    );
  }

  const groupId = callInvite.groupId;
  const group = conversations.find((c) => c.id === groupId);
  const inThisCall = activeCallConversationId === groupId;
  // `state.participants` never holds yourself
  const others = [...state.participants.values()].filter((p) => p.callConversationId === groupId);
  const people = inThisCall
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarPoster: state.me.avatarPoster, avatarColor: state.me.avatarColor }, ...others]
    : others;
  const live = people.length > 0;
  const title = group?.title ?? callInvite.groupTitle;

  return (
    <div className="mt-1 max-w-[420px] overflow-hidden rounded-lg border border-border bg-fill-subtle" data-call-invite={live ? 'live' : 'ended'}>
      <div className="flex items-center gap-2.5 px-4 py-3">
        <SpeakerHighIcon size={22} weight="fill" className={cn('flex-none', live ? 'text-green' : 'text-text-muted')} />
        <GroupAvatar id={groupId} title={title} avatar={group?.avatar ?? callInvite.groupAvatar} size={24} />
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-text-primary">{title}</p>
          <p className="text-caption text-text-muted">{t('callInvite.header')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 bg-fill-inset px-4 py-3">
        {!group ? (
          <p className="text-label text-text-muted">{t('callInvite.notMember')}</p>
        ) : !live ? (
          <p className="text-label text-text-muted">{t('callInvite.ended')}</p>
        ) : (
          <>
            {people.length === 1 ? (
              <div className="flex items-center gap-2">
                <Avatar id={people[0]!.id} name={people[0]!.displayName} avatar={people[0]!.avatar} poster={people[0]!.avatarPoster} avatarColor={people[0]!.avatarColor} size={24} />
                <span className="truncate text-label text-text-secondary">{people[0]!.displayName}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex items-center -space-x-1.5">
                  {people.slice(0, SHOWN_PARTICIPANTS).map((p) => (
                    <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} poster={p.avatarPoster} avatarColor={p.avatarColor} size={24} className="ring-2 ring-bg-secondary" />
                  ))}
                </span>
                <span className="truncate text-label text-text-secondary">{t('callInvite.inCall', { count: people.length })}</span>
              </div>
            )}
            <Button type="button" onClick={() => openCall(groupId)} className="w-full bg-green-solid text-white hover:bg-green-hover">
              <SpeakerHighIcon size={20} weight="fill" />
              {inThisCall ? t('callInvite.return') : t('callInvite.join')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
