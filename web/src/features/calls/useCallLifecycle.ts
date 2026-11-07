import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, DisconnectReason, RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { LocalTrackPublication, Track as LKTrack } from 'livekit-client';
import { playSound } from '@/shared/sounds';
import { useTrackSpeaking } from '@/features/calls/useLiveKitTrack';
import { cameraIsTransmitting, screenIsSharing } from '@/features/calls/mediaPublication';
import type { RoomAction } from '@/state/roomReducer';
import type { ClientMessage } from '@/shared/types/protocol';
import { logger } from '@/shared/lib/logger';
import { i18n } from '@/shared/i18n/init';

const log = logger.child({ component: 'call' });

interface CallLifecycleDeps {
  livekitRoom: Room;
  dispatch: Dispatch<RoomAction>;
  sendWs: (msg: ClientMessage) => void;
  stopCamera: () => void | Promise<void>;
  stopSharing: () => void | Promise<void>;
  activateMic: () => Promise<void>;
  setMicMuted: (muted: boolean) => Promise<void>;
  leaveMic: () => Promise<void>;
  startCamera: () => Promise<void>;
  cameraOn: boolean;
  sharing: boolean;
}

/** Everything about being connected to a LiveKit call: join/leave/kick,
 * deafened/audio-unlock state, and reporting our own local media state
 * (mic/camera/screen-share/speaking) back over the websocket whenever
 * LiveKit's own events say it changed. Takes `livekitRoom` as a parameter
 * (rather than creating it) because the camera/screen-share/mic hooks this
 * one composes ALSO take it as their own first argument — RoomProvider
 * creates the single `Room` instance and threads it through all of them,
 * this hook included, in the same call. */
export function useCallLifecycle(deps: CallLifecycleDeps) {
  const { livekitRoom, dispatch, sendWs, stopCamera, stopSharing, activateMic, setMicMuted, leaveMic, startCamera, cameraOn, sharing } = deps;

  const [audioUnlocked, setAudioUnlocked] = useState(false);
  useEffect(() => {
    if (audioUnlocked) return;
    const unlock = () => setAudioUnlocked(true);
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [audioUnlocked]);

  const [deafened, setDeafened] = useState(false);
  const deafenedRef = useRef(false);
  useEffect(() => { deafenedRef.current = deafened; }, [deafened]);

  const [preferMuted, setPreferMutedState] = useState(false);
  const preferMutedRef = useRef(false);
  const setPreferMuted = useCallback((muted: boolean) => {
    preferMutedRef.current = muted;
    setPreferMutedState(muted);
  }, []);

  // LiveKit retries the connection on its own on a network hiccup — this just
  // surfaces that it's happening, distinct from RoomEvent.Disconnected below
  // (which means the retry gave up, or we hung up on purpose).
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    const onReconnecting = () => setReconnecting(true);
    const onReconnected = () => setReconnecting(false);
    livekitRoom.on(RoomEvent.Reconnecting, onReconnecting);
    livekitRoom.on(RoomEvent.Reconnected, onReconnected);
    livekitRoom.on(RoomEvent.Disconnected, onReconnected);
    return () => {
      livekitRoom.off(RoomEvent.Reconnecting, onReconnecting);
      livekitRoom.off(RoomEvent.Reconnected, onReconnected);
      livekitRoom.off(RoomEvent.Disconnected, onReconnected);
    };
  }, [livekitRoom]);

  const [activeCallConversationId, setActiveCallConversationIdState] = useState<string | null>(null);
  const activeCallConversationIdRef = useRef<string | null>(null);
  const pendingCallConversationIdRef = useRef<string | null>(null);
  const switchingRef = useRef<Promise<void> | null>(null);
  const videoAfterConnectRef = useRef(false);
  const setActiveCallConversationId = useCallback((id: string | null) => {
    activeCallConversationIdRef.current = id;
    setActiveCallConversationIdState(id);
  }, []);

  const toggleDeafened = useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    if (next) setMicMuted(true);
    playSound(next ? 'deafened' : 'undeafened');
    sendWs({ t: 'deafened', value: next });
  }, [deafened, setMicMuted, sendWs]);

  const leaveCall = useCallback(async () => {
    const leaving = activeCallConversationIdRef.current;
    if (cameraOn) await stopCamera();
    if (sharing) await stopSharing();
    await leaveMic();
    livekitRoom.disconnect();
    sendWs({ t: 'call-leave' });
    // A DM can arm its own pending id while this leave is still stopping the
    // previous room. Only drop the id that belonged to the call we left.
    if (pendingCallConversationIdRef.current === leaving) pendingCallConversationIdRef.current = null;
    if (activeCallConversationIdRef.current === leaving) setActiveCallConversationId(null);
  }, [cameraOn, sharing, stopCamera, stopSharing, leaveMic, livekitRoom, sendWs, setActiveCallConversationId]);

  const joinCall = useCallback(async (conversationId: string) => {
    if (activeCallConversationIdRef.current === conversationId) return;
    if (activeCallConversationIdRef.current) await leaveCall();
    pendingCallConversationIdRef.current = conversationId;
    dispatch({ type: 'SET_CALL_JOIN_ERROR', error: null });
    sendWs({ t: 'call-join', conversationId });
  }, [sendWs, leaveCall, dispatch]);

  /** After a socket reconnect: the media may still be up while the server no
   * longer has this connection in the call (it lost its state, or the grace window
   * ran out). A voice channel is simply joined again; a direct call cannot be, so
   * it is left instead of lingering as a room nobody else is in. */
  const reconcileAfterReconnect = useCallback((serverCallId: string | null | undefined, isDirect: (conversationId: string) => boolean) => {
    const mine = activeCallConversationIdRef.current;
    if (serverCallId === undefined || !mine || serverCallId === mine) return;
    void leaveCall().then(() => { if (!isDirect(mine)) void joinCall(mine); });
  }, [leaveCall, joinCall]);

  const leaveCallRef = useRef(leaveCall);
  useEffect(() => { leaveCallRef.current = leaveCall; }, [leaveCall]);

  const kickFromCall = useCallback((participantId: string) => sendWs({ t: 'call-kick', participantId }), [sendWs]);
  const moveToCall = useCallback((participantId: string, conversationId: string) => sendWs({ t: 'call-move', participantId, conversationId }), [sendWs]);

  /** A moderator moved this connection: the server already took it out of
   * the old room, so this is an ordinary join of the new one (with the
   * account's own permissions, and the same mute/deafen it had). */
  const onCallMoved = useCallback((conversationId: string) => { void joinCall(conversationId); }, [joinCall]);

  /** A DM token is about to arrive. Leaving a voice channel first must not
   * throw away the id this tab is waiting to connect to. */
  const dropPendingCall = useCallback((conversationId: string) => {
    if (pendingCallConversationIdRef.current !== conversationId) return;
    pendingCallConversationIdRef.current = null;
    videoAfterConnectRef.current = false;
  }, []);

  const armDmMedia = useCallback((conversationId: string, video: boolean) => {
    const current = activeCallConversationIdRef.current;
    if (current === conversationId && livekitRoom.state === ConnectionState.Connected) return;
    videoAfterConnectRef.current = video;
    pendingCallConversationIdRef.current = conversationId;
    if (current && current !== conversationId) {
      const pendingLeave = leaveCall();
      switchingRef.current = pendingLeave;
      void pendingLeave.finally(() => {
        if (switchingRef.current === pendingLeave) switchingRef.current = null;
      });
    }
  }, [leaveCall, livekitRoom]);

  const onCallToken = useCallback((m: { conversationId: string; livekitUrl: string; livekitToken: string }) => {
    if (m.conversationId !== pendingCallConversationIdRef.current) return;
    if (activeCallConversationIdRef.current === m.conversationId && livekitRoom.state === ConnectionState.Connected) return;
    const connect = async () => {
      if (switchingRef.current) await switchingRef.current;
      if (pendingCallConversationIdRef.current !== m.conversationId) return;
      await livekitRoom.connect(m.livekitUrl, m.livekitToken);
      await activateMic();
      if (preferMutedRef.current || deafenedRef.current) await setMicMuted(true);
      if (videoAfterConnectRef.current) {
        videoAfterConnectRef.current = false;
        await startCamera();
      }
    };
    void connect()
      .catch((err) => {
        log.error('LiveKit connect failed', err, { conversationId: m.conversationId });
        // Already left (or switched calls) while connecting — that rejection
        // is expected. Checked against the pending join, not the active call:
        // a failed connect also fires Disconnected, which clears the active
        // call before this runs.
        if (pendingCallConversationIdRef.current !== m.conversationId) return;
        // Back out entirely, server side included: staying "in" a call that
        // never connected shows an empty stage, and joinCall ignores a
        // conversation it thinks is already active, so retrying did nothing.
        sendWs({ t: 'call-leave' });
        pendingCallConversationIdRef.current = null;
        setActiveCallConversationId(null);
        dispatch({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: m.conversationId, message: i18n.t('calls:errors.joinCall') } });
      });
    setActiveCallConversationId(m.conversationId);
  }, [livekitRoom, activateMic, setMicMuted, startCamera, setActiveCallConversationId, sendWs, dispatch]);

  /** If a conversation currently in a call gets deleted out from under us
   * (admin action), leave it — same as clicking "leave call" ourselves. */
  const onConversationDeleted = useCallback((conversationId: string) => {
    if (conversationId === activeCallConversationIdRef.current) leaveCallRef.current();
  }, []);

  /** The server refused a call-join (no access, not friends, LiveKit
   * down) — clears the pending join so a stale call-token arriving late can't
   * be mistaken for this failed attempt. Returns false when no join was
   * pending: the same error codes also answer other requests. */
  const onCallJoinRejected = useCallback((message: string): boolean => {
    const conversationId = pendingCallConversationIdRef.current;
    if (!conversationId) return false;
    pendingCallConversationIdRef.current = null;
    dispatch({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId, message } });
    return true;
  }, [dispatch]);

  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      // The room is already gone, so stopping the devices only clears our
      // own flags. call-leave is what drops the camera/mic/share the server
      // is still advertising to everyone else.
      if (cameraOn) void stopCamera();
      if (sharing) void stopSharing();
      sendWs({ t: 'call-leave' });
      setActiveCallConversationId(null);
    };
    livekitRoom.on(RoomEvent.Disconnected, onDisconnected);
    return () => { livekitRoom.off(RoomEvent.Disconnected, onDisconnected); };
  }, [livekitRoom, stopCamera, stopSharing, setActiveCallConversationId, cameraOn, sharing, sendWs]);

  useEffect(() => {
    const onLocalUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
      if (pub.source === Track.Source.Camera) dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
    };
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    return () => { livekitRoom.off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished); };
  }, [livekitRoom, dispatch]);

  useEffect(() => {
    const onPublished = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) playSound('incomingUser');
      if (pub.source === Track.Source.ScreenShare) playSound('screenshare');
      if (pub.source === Track.Source.Camera) playSound('camera');
    };
    const onMicUnpublished = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) playSound('userLeave');
    };
    livekitRoom.on(RoomEvent.TrackPublished, onPublished);
    livekitRoom.on(RoomEvent.TrackUnpublished, onMicUnpublished);
    livekitRoom.on(RoomEvent.LocalTrackPublished, onPublished);
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onMicUnpublished);
    return () => {
      livekitRoom.off(RoomEvent.TrackPublished, onPublished);
      livekitRoom.off(RoomEvent.TrackUnpublished, onMicUnpublished);
      livekitRoom.off(RoomEvent.LocalTrackPublished, onPublished);
      livekitRoom.off(RoomEvent.LocalTrackUnpublished, onMicUnpublished);
    };
  }, [livekitRoom, sendWs]);

  const [localMic, setLocalMic] = useState<{ track: LKTrack | null; muted: boolean }>({ track: null, muted: true });
  const syncLocalMediaRef = useRef<() => void>(() => {});
  useEffect(() => {
    function reportMic() {
      const pub = livekitRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
      setLocalMic({ track: pub?.track ?? null, muted: pub ? pub.isMuted : true });
      sendWs({ t: 'mic-state', activated: !!pub, muted: pub ? pub.isMuted : true });
    }
    function reportCamera() {
      const publication = livekitRoom.localParticipant.getTrackPublication(Track.Source.Camera);
      const on = cameraIsTransmitting(publication);
      dispatch({ type: 'SET_LOCAL_CAMERA', on });
      sendWs({ t: 'camera', on });
    }
    function reportSharing() {
      const publication = livekitRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      const on = screenIsSharing(publication);
      dispatch({ type: 'SET_LOCAL_SHARING', sharing: on });
      sendWs({ t: 'screen-share', on });
    }
    function reportLocalMedia() {
      reportMic();
      reportCamera();
      reportSharing();
    }
    const onPublishChange = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) reportMic();
      if (pub.source === Track.Source.Camera) reportCamera();
      if (pub.source === Track.Source.ScreenShare) reportSharing();
    };
    const onMuteChange = (pub: { source: Track.Source }, participant: { identity: string }) => {
      if (participant.identity !== livekitRoom.localParticipant.identity) return;
      onPublishChange(pub);
    };
    livekitRoom.on(RoomEvent.LocalTrackPublished, onPublishChange);
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onPublishChange);
    livekitRoom.on(RoomEvent.TrackMuted, onMuteChange);
    livekitRoom.on(RoomEvent.TrackUnmuted, onMuteChange);
    livekitRoom.on(RoomEvent.Reconnected, reportLocalMedia);
    syncLocalMediaRef.current = reportLocalMedia;
    return () => {
      livekitRoom.off(RoomEvent.LocalTrackPublished, onPublishChange);
      livekitRoom.off(RoomEvent.LocalTrackUnpublished, onPublishChange);
      livekitRoom.off(RoomEvent.TrackMuted, onMuteChange);
      livekitRoom.off(RoomEvent.TrackUnmuted, onMuteChange);
      livekitRoom.off(RoomEvent.Reconnected, reportLocalMedia);
    };
  }, [livekitRoom, sendWs, dispatch]);

  const syncLocalMedia = useCallback(() => { syncLocalMediaRef.current(); }, []);

  const isSpeakingLocal = useTrackSpeaking(localMic.track, localMic.muted);
  useEffect(() => {
    sendWs({ t: 'speaking', value: isSpeakingLocal });
  }, [isSpeakingLocal, sendWs]);

  return {
    audioUnlocked, deafened, toggleDeafened, preferMuted, setPreferMuted, reconnecting,
    activeCallConversationId, joinCall, leaveCall, armDmMedia, dropPendingCall, kickFromCall, moveToCall,
    onCallToken, onCallMoved, onConversationDeleted, onCallJoinRejected, syncLocalMedia, reconcileAfterReconnect,
  };
}
