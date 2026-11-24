import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import { getActivePlaygroundSession, PlaygroundSession, setActivePlaygroundSession, usePlaygroundSession } from './playgroundSession';
import type { PlaygroundMember } from './playgroundSession';
import { screenPresenterId } from './screenPresenter';

function sameMembers(a: PlaygroundMember[], b: PlaygroundMember[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i]!.id && m.userId === b[i]!.userId);
}

/** Mounted for as long as the active call is a playground (App.tsx), with or
 * without its 3D view on screen. Renders nothing. */
export function PlaygroundLayer({ conversationId, participantIds }: { conversationId: string; participantIds: string[] }) {
  const { t } = useTranslation('playground');
  const { livekitRoom, audioRegistry, stopSharing, dispatch } = useRoom('livekitRoom', 'audioRegistry', 'stopSharing', 'dispatch');
  const { me } = useRoomState('me');
  const meId = me.id;
  const meUserId = me.userId;
  const session = usePlaygroundSession();
  const members = useRoomSelector((room) => participantIds.flatMap((id): PlaygroundMember[] => {
    const userId = room.state.participants.get(id)?.userId;
    return userId ? [{ id, userId }] : [];
  }), sameMembers);
  const presenterId = useRoomSelector((room) => screenPresenterId(room, conversationId));

  useEffect(() => {
    if (!meId || !meUserId) return;
    const created = new PlaygroundSession(livekitRoom, conversationId, meId, meUserId, audioRegistry);
    created.start();
    setActivePlaygroundSession(created);
    return () => {
      created.dispose();
      if (getActivePlaygroundSession() === created) setActivePlaygroundSession(null);
    };
  }, [livekitRoom, conversationId, meId, meUserId, audioRegistry]);

  // a new session (after a reconnect gives you a new id) hears the roster too
  useEffect(() => {
    session?.retain(members);
  }, [session, members]);

  // one screen, one presenter: whoever started second gives it up
  const sharing = me.sharing;
  useEffect(() => {
    if (!sharing || !presenterId || presenterId === meId) return;
    stopSharing();
    dispatch({ type: 'SET_SHARE_ERROR', message: t('screen.taken') });
  }, [sharing, presenterId, meId, stopSharing, dispatch, t]);

  return null;
}
