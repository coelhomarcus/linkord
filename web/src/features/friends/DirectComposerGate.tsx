import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { ProfileActions } from './ProfileActions';
import { useRelationship } from './useRelationship';

/** Keep history readable while explaining why sending is unavailable and how to restore access. */
export function DirectComposerGate({ conversationId, children }: { conversationId: string; children: ReactNode }) {
  const { t } = useTranslation('friends');
  const { conversations, allUsers, state } = useRoom();
  const conversation = conversations.find((item) => item.id === conversationId);
  const peerId = conversation?.type === 'direct' ? (conversation.memberIds.find((id) => id !== state.me.userId) ?? null) : null;
  const { state: relationship } = useRelationship(peerId);

  if (!peerId || relationship.status !== 'ready' || relationship.value.relation === 'friends') return <>{children}</>;

  const peer = allUsers.get(peerId);
  const blocked = relationship.value.relation === 'blocked';
  return (
    <div className="mx-3 mb-3 rounded-lg border border-border bg-bg-secondary p-3 md:mx-4 md:mb-4">
      <p className="px-4 pt-1 pb-2 text-label text-text-muted">
        {blocked
          ? t('gate.blocked')
          : t('gate.notFriends')}
      </p>
      {peer && <ProfileActions userId={peer.id} username={peer.username} displayName={peer.displayName} />}
    </div>
  );
}
