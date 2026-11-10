import { useEffect, useRef } from 'react';
import { APP_TITLE } from '@/features/conversations/conversationUtils';

// The conference actions are newer than TypeScript's DOM lib.
type CallAction = 'togglemicrophone' | 'hangup';
type ConferenceMediaSession = MediaSession & { setMicrophoneActive?: (active: boolean) => void };

function mediaSession(): ConferenceMediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
}

function setCallAction(session: MediaSession, action: CallAction, handler: (() => void) | null): void {
  // Throws for an action the browser does not know.
  try { session.setActionHandler(action as MediaSessionAction, handler); } catch { /* unsupported */ }
}

interface CallMediaSessionOptions {
  inCall: boolean;
  title: string;
  /** null while there is no mic to mute (not activated, or no permission to speak) */
  micMuted: boolean | null;
  toggleMic: () => void;
  hangUp: () => void;
}

/** Tells the browser a call is going on, so the media controls it shows (the
 * notification on Android, the lock screen, the media hub) name the call and
 * offer mute and hang up. Android is also less eager to suspend a page it
 * knows is playing. */
export function useCallMediaSession({ inCall, title, micMuted, toggleMic, hangUp }: CallMediaSessionOptions): void {
  const toggleMicRef = useRef(toggleMic);
  const hangUpRef = useRef(hangUp);
  useEffect(() => {
    toggleMicRef.current = toggleMic;
    hangUpRef.current = hangUp;
  }, [toggleMic, hangUp]);

  useEffect(() => {
    const session = mediaSession();
    if (!session || !inCall) return;
    if (typeof MediaMetadata !== 'undefined') session.metadata = new MediaMetadata({ title, artist: APP_TITLE });
    session.playbackState = 'playing';
    return () => {
      session.metadata = null;
      session.playbackState = 'none';
    };
  }, [inCall, title]);

  useEffect(() => {
    const session = mediaSession();
    if (!session || !inCall) return;
    setCallAction(session, 'hangup', () => hangUpRef.current());
    return () => setCallAction(session, 'hangup', null);
  }, [inCall]);

  const hasMic = micMuted !== null;
  useEffect(() => {
    const session = mediaSession();
    if (!session || !inCall || !hasMic) return;
    setCallAction(session, 'togglemicrophone', () => toggleMicRef.current());
    return () => setCallAction(session, 'togglemicrophone', null);
  }, [inCall, hasMic]);

  useEffect(() => {
    const session = mediaSession();
    if (!session?.setMicrophoneActive || !inCall || micMuted === null) return;
    try { session.setMicrophoneActive(!micMuted); } catch { /* unsupported */ }
  }, [inCall, micMuted]);
}
