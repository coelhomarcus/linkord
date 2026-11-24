import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import { getActivePlaygroundSession, PlaygroundSession, setActivePlaygroundSession } from './playgroundSession';
import { screenPresenterId } from './screenPresenter';

/** Mounted for as long as the active call is a playground (App.tsx), with or
 * without its 3D view on screen. Renders nothing. */
export function PlaygroundLayer({ conversationId, participantIds }: { conversationId: string; participantIds: string[] }) {
  const { t } = useTranslation('playground');
  const { livekitRoom, audioRegistry, stopSharing, dispatch } = useRoom('livekitRoom', 'audioRegistry', 'stopSharing', 'dispatch');
  const { me } = useRoomState('me');
  const meId = me.id;
  const presenterId = useRoomSelector((room) => screenPresenterId(room, conversationId));

  useEffect(() => {
    if (!meId) return;
    const session = new PlaygroundSession(livekitRoom, conversationId, meId, audioRegistry);
    session.start();
    setActivePlaygroundSession(session);
    return () => {
      session.dispose();
      if (getActivePlaygroundSession() === session) setActivePlaygroundSession(null);
    };
  }, [livekitRoom, conversationId, meId, audioRegistry]);

  useEffect(() => {
    getActivePlaygroundSession()?.retain(participantIds);
  }, [participantIds]);

  // one screen, one presenter: whoever started second gives it up
  const sharing = me.sharing;
  useEffect(() => {
    if (!sharing || !presenterId || presenterId === meId) return;
    stopSharing();
    dispatch({ type: 'SET_SHARE_ERROR', message: t('screen.taken') });
  }, [sharing, presenterId, meId, stopSharing, dispatch, t]);

  return null;
}
