import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { useCallRoster } from '@/features/calls/callRoster';
import type { Conversation } from '@/shared/types/protocol';
import { PERMISSIONS } from './permissionBits';
import { canInChannel } from './serverUtils';
import { ChannelGlyph } from './ChannelGlyph';

/** A voice channel you aren't in: who is there, and the button to join. */
export function VoiceChannelLobby({ channel, onJoin }: { channel: Conversation; onJoin: () => void }) {
  const { t } = useTranslation('servers');
  const { allUsers } = useRoom('allUsers');
  const state = useRoomState('callJoinError');
  const roster = useCallRoster();
  const inside = [...roster.values()].filter((p) => p.callConversationId === channel.id);
  const error = state.callJoinError?.conversationId === channel.id ? state.callJoinError.message : null;
  return (
    <main className="flex h-full flex-col items-center justify-center gap-5 bg-bg-call p-6 text-center text-text-strong">
      <ChannelGlyph channel={channel} size={48} weight="fill" className="opacity-70" />
      <h1 className="text-display font-semibold">{channel.title}</h1>
      <p className="text-label text-text-secondary">{inside.length ? t('voice.inside', { count: inside.length }) : t('voice.empty')}</p>
      {inside.length > 0 && (
        <div className="flex -space-x-2">
          {inside.slice(0, 8).map((p) => {
            const user = allUsers.get(p.userId);
            return <Avatar key={p.id} id={p.userId} name={p.displayName} avatar={p.avatar} avatarColor={user?.avatarColor ?? p.avatarColor} size={40} className="ring-4 ring-bg-call" />;
          })}
        </div>
      )}
      {error && <p role="alert" className="text-label text-red-text">{error}</p>}
      <Button type="button" onClick={onJoin} disabled={!canInChannel(channel, PERMISSIONS.CONNECT)} className="bg-green-solid px-6 hover:bg-green-solid/90">
        {canInChannel(channel, PERMISSIONS.CONNECT) ? t('voice.join') : t('voice.noAccess')}
      </Button>
    </main>
  );
}
