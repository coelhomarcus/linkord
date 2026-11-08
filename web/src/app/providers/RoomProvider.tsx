import { useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react';
import type { ReactNode } from 'react';
import { Room } from 'livekit-client';
import type { Socket } from 'socket.io-client';
import { RoomContext } from '@/state/RoomContext';
import type { AudioHandle, TileDomHandle } from '@/state/RoomContext';
import { roomReducer, initialRoomState } from '@/state/roomReducer';
import { useAuth } from '@/state/AuthContext';
import { saveIdentity } from '@/shared/lib/identitySession';
import { useSocketConnection } from '@/state/hooks/useSocketConnection';
import { useScreenShare } from '@/features/calls/useScreenShare';
import { useCallFullscreen } from '@/features/calls/useCallFullscreen';
import { useCamera } from '@/features/calls/useCamera';
import { useMicrophone } from '@/features/calls/useMicrophone';
import { useTileMenu } from '@/features/calls/useTileMenu';
import { useConversationsList } from '@/features/conversations/useConversationsList';
import { useServersList } from '@/features/servers/useServersList';
import { useChatMessages } from '@/features/chat/useChatMessages';
import type { ChatView } from '@/features/chat/useChatMessages';
import { useTypingIndicator } from '@/state/hooks/useTypingIndicator';
import { useSoundboardEvents } from '@/features/soundboard/useSoundboardEvents';
import { useMessageSearch } from '@/features/chat/useMessageSearch';
import { usePresence } from '@/state/hooks/usePresence';
import { useCallLifecycle } from '@/features/calls/useCallLifecycle';
import { useDmCall } from '@/features/calls/useDmCall';
import { captureScreenPreview } from '@/features/calls/captureScreenPreview';
import { streamPreviewStore } from '@/features/calls/streamPreviewStore';
import { useRoomSettings } from '@/features/settings/useRoomSettings';
import { useProfileUpdate } from '@/features/profile/useProfileUpdate';
import { preloadSounds } from '@/shared/sounds';
import { setNotificationClickHandler } from '@/shared/notifications';
import { DEFAULT_MAX_ATTACHMENT_BYTES } from '@/shared/types/protocol';
import type { ClientMessage, Conversation, ServerMessage } from '@/shared/types/protocol';
import { logger } from '@/shared/lib/logger';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { i18n } from '@/shared/i18n/init';

const log = logger.child({ component: 'room' });

export function RoomProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const { refresh: refreshAuth } = useAuth();

  const myIdRef = useRef<string | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const myUsernameRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tileDomRegistry = useRef<Map<string, TileDomHandle>>(new Map());
  const audioRegistry = useRef<Map<string, AudioHandle>>(new Map());
  const callStageRef = useRef<HTMLElement | null>(null);
  const { isCallFullscreen, toggleCallFullscreen, fullscreenElement } = useCallFullscreen(callStageRef);
  // owned here (not inside useSocketConnection) because sendWs needs to
  // read it and is constructed before that hook runs — nearly every domain
  // hook below needs sendWs too.
  const socketRef = useRef<Socket | null>(null);
  const intentionalCloseRef = useRef(false);
  const hasWelcomedRef = useRef(false);

  // Adaptive stream picks the camera simulcast layer from the tile's size.
  // `screen` counts device pixels: a plain `true` ignores a 2x display, so a
  // retina tile stays on the soft layer while a screen share (one layer, no
  // simulcast) stays sharp beside it. Dynacast stops encoding a layer nobody
  // is watching.
  const [livekitRoom] = useState(() => new Room({
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: true,
  }));

  const sendWs = useCallback((msg: ClientMessage): boolean => {
    if (!socketRef.current?.connected) return false;
    socketRef.current.emit(msg.t, msg);
    return true;
  }, []);
  const isSocketConnected = useCallback(() => !!socketRef.current?.connected, []);

  const activeViewRef = useRef<ChatView>('chat');
  // set once the chat hook below exists: coming back to the chat reads what arrived meanwhile
  const markActiveSeenRef = useRef<(() => void) | null>(null);
  const notifyActiveView = useCallback((view: ChatView) => {
    const was = activeViewRef.current;
    activeViewRef.current = view;
    if (view === 'chat' && was !== 'chat') markActiveSeenRef.current?.();
  }, []);
  const requestChatViewRef = useRef<((conversationId?: string) => void) | null>(null);
  const registerRequestChatView = useCallback((fn: (conversationId?: string) => void) => { requestChatViewRef.current = fn; }, []);
  const requestChatView = useCallback((conversationId?: string) => { requestChatViewRef.current?.(conversationId); }, []);
  const openCallRef = useRef<((conversationId: string) => void) | null>(null);
  const registerOpenCall = useCallback((fn: (conversationId: string) => void) => { openCallRef.current = fn; }, []);
  const openCall = useCallback((conversationId: string) => { openCallRef.current?.(conversationId); }, []);

  // a refusal the socket sent without a request to answer (a call kick the
  // actor may not do, a quota) — shown as a banner, since nothing else waits on it
  const [actionError, setActionError] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  // bumped whenever the server says friends/requests/blocks changed — the
  // friends feature refetches its own lists off this, so social state never
  // has to live inside the room reducer
  const [socialRevision, setSocialRevision] = useState(0);

  // Domain hooks — each owns one slice of what used to all live directly in
  // this component (see the module comment in each hooks/use*.ts file for
  // why it's split this way). Construction order matters in a couple of
  // spots: presence before chatMessages (chatMessages reads its allUsersRef),
  // and the camera/screen-share/mic hooks before useCallLifecycle (it
  // composes their leave/mute functions).
  const conversationsList = useConversationsList(sendWs);
  const serversList = useServersList();
  // DMs and channels as one list: chat, unread and calls look up whichever it is by id
  const allConversations = useMemo<Conversation[]>(
    () => [...conversationsList.conversations, ...serversList.channelConversations],
    [conversationsList.conversations, serversList.channelConversations],
  );
  const allConversationsRef = useRef<Conversation[]>(allConversations);
  allConversationsRef.current = allConversations;
  const presence = usePresence();
  const typingIndicator = useTypingIndicator(sendWs, myUserIdRef);
  const chatMessages = useChatMessages({
    sendWs,
    activeConversationIdRef: conversationsList.activeConversationIdRef,
    setActiveConversation: conversationsList.setActiveConversation,
    conversationsRef: allConversationsRef,
    allUsersRef: presence.allUsersRef,
    myUserIdRef,
    myUsernameRef,
    activeViewRef,
    clearTypingEntry: typingIndicator.clearTypingEntry,
  });
  useEffect(() => { markActiveSeenRef.current = chatMessages.markActiveSeen; }, [chatMessages.markActiveSeen]);
  const messageSearch = useMessageSearch(sendWs);
  const [maxAttachmentBytes, setMaxAttachmentBytes] = useState(DEFAULT_MAX_ATTACHMENT_BYTES);

  const { startSharing, stopSharing, changeSource, pauseSharePreview, resumeSharePreview } = useScreenShare(livekitRoom, dispatch);
  const { startCamera, stopCamera } = useCamera(livekitRoom, dispatch);
  const { activateMic, toggleMicMuted, setMicMuted, leaveMic } = useMicrophone(livekitRoom, dispatch);

  const roomSettings = useRoomSettings();

  const callLifecycle = useCallLifecycle({
    livekitRoom, dispatch, sendWs, stopCamera, stopSharing, activateMic, setMicMuted, leaveMic, startCamera,
    cameraOn: state.me.cameraOn, sharing: state.me.sharing,
  });
  const dmCall = useDmCall({
    sendWs,
    armDmMedia: callLifecycle.armDmMedia,
    leaveCall: callLifecycle.leaveCall,
    dropPendingCall: callLifecycle.dropPendingCall,
    activeCallId: () => callLifecycle.activeCallConversationId,
    myUserId: () => myUserIdRef.current,
  });
  const soundboardEvents = useSoundboardEvents({
    activeCallConversationId: callLifecycle.activeCallConversationId,
    deafened: callLifecycle.deafened,
  });

  const profileUpdate = useProfileUpdate({
    dispatch, sendWs, myUserIdRef, setAllUsers: presence.setAllUsers, name: state.me.name, isConnected: isSocketConnected,
  });

  const tileMenu = useTileMenu();

  /** The FULL "open a conversation" behavior — cursor move (conversationsList)
   * plus resetting this conversation's unread/reply/editing state
   * (chatMessages) plus telling the server. Composed here, not inside
   * either hook, because it's the one operation that genuinely spans both
   * of their state. */
  const openConversation = useCallback((conversationId: string) => {
    conversationsList.setActiveConversation(conversationId);
    chatMessages.clearUnread(conversationId);
    chatMessages.setReplyingTo(null);
    chatMessages.setEditingMsgId(null);
    sendWs({ t: 'conversation-open', conversationId });
  }, [conversationsList.setActiveConversation, chatMessages.clearUnread, chatMessages.setReplyingTo, chatMessages.setEditingMsgId, sendWs]);

  const closeConversation = useCallback((conversationId: string) => {
    conversationsList.removeConversation(conversationId);
    chatMessages.clearUnread(conversationId);
    sendWs({ t: 'conversation-close', conversationId });
  }, [conversationsList.removeConversation, chatMessages.clearUnread, sendWs]);


  const disconnectIntentionally = useCallback(() => {
    intentionalCloseRef.current = true;
    try { socketRef.current?.disconnect(); } catch { /* socket ja morrendo */ }
  }, []);

  const handleServerMessage = useCallback((m: ServerMessage) => {
    switch (m.t) {
      case 'welcome': {
        myIdRef.current = m.id;
        myUserIdRef.current = m.userId;
        myUsernameRef.current = m.name;
        tokenRef.current = m.token;
        saveIdentity(m.id, m.token);
        dispatch({
          type: 'WELCOME',
          id: m.id,
          userId: m.userId,
          name: m.name,
          displayName: m.displayName,
          avatar: m.avatar,
          avatarPoster: m.avatarPoster,
          avatarColor: m.avatarColor,
          banner: m.banner,
          bannerPoster: m.bannerPoster,
          bio: m.bio,
          profileLinks: m.profileLinks,
          role: m.role,
          participants: m.participants,
        });
        conversationsList.setInitial(m.conversations ?? []);
        serversList.setInitial(m.servers ?? []);
        chatMessages.onWelcome(m.unreadByConversation);
        presence.setInitial(m.knownUsers, m.onlineUserIds, m.friendIds);
        setMaxAttachmentBytes(m.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES);
        // the first welcome opens nothing: the URL says what to show (the
        // route sync opens it). A reconnect reloads what was open.
        if (hasWelcomedRef.current) {
          // The socket is new; LiveKit may still be in the call. Tell the
          // server what the tracks are doing now, not what they were doing
          // when the previous socket dropped.
          callLifecycle.syncLocalMedia();
          // a direct call being resumed carries its own token right after this welcome
          const serverCallId = m.dmCall?.media ? m.dmCall.conversationId : m.callConversationId;
          callLifecycle.reconcileAfterReconnect(serverCallId, (id) => (m.conversations ?? []).some((c) => c.id === id));
          const activeId = conversationsList.activeConversationIdRef.current;
          const stillThere = (m.conversations ?? []).some((c) => c.id === activeId)
            || (m.servers ?? []).some((server) => server.channels.some((c) => c.id === activeId));
          if (activeId && activeViewRef.current === 'chat' && stillThere) sendWs({ t: 'conversation-open', conversationId: activeId });
        }
        hasWelcomedRef.current = true;
        if (m.dmCall) dmCall.onDmCall(m.dmCall);
        dmCall.onReconnected(m.dmCall ?? null);
        break;
      }
      case 'dm-call':
        dmCall.onDmCall(m);
        break;
      case 'dm-call-ended':
        dmCall.onEnded(m);
        break;
      case 'call-token':
        callLifecycle.onCallToken(m);
        break;
      case 'call-moved':
        callLifecycle.onCallMoved(m.conversationId);
        break;
      case 'stream-preview-capture':
        void captureScreenPreview(livekitRoom).then((image) => { if (image) sendWs({ t: 'stream-preview-frame', image }); });
        break;
      case 'stream-preview':
        streamPreviewStore.set(m.participantId, m.image);
        break;
      case 'participant-joined':
        dispatch({ type: 'PARTICIPANT_JOINED', participant: m.participant });
        presence.onParticipantJoined(m);
        break;
      case 'profile-connections-changed':
        dispatch({ type: 'PROFILE_CONNECTIONS_CHANGED', userId: m.userId, profileLinks: m.profileLinks });
        presence.setAllUsers((previous) => {
          const user = previous.get(m.userId);
          if (!user) return previous;
          return new Map(previous).set(m.userId, { ...user, profileLinks: m.profileLinks });
        });
        window.dispatchEvent(new CustomEvent('profile-connections-changed', { detail: m.userId }));
        break;
      case 'participant-updated':
        dispatch({ type: 'PARTICIPANT_UPDATED', participant: m.participant });
        presence.onParticipantUpdated(m);
        break;
      case 'participant-left':
        dispatch({ type: 'PARTICIPANT_LEFT', id: m.id });
        break;
      case 'soundboard-play':
        soundboardEvents.onSoundboardPlay(m);
        break;
      case 'server-sounds-changed':
        soundboardEvents.onServerSoundsChanged(m);
        break;
      case 'server-created':
      case 'server-updated':
        serversList.onServerChanged(m);
        break;
      case 'server-deleted': {
        const gone = serversList.onServerDeleted(m);
        if (gone && m.reason) setAccessNotice(i18n.t(`room.server.${m.reason}`, { name: gone.name }));
        if (gone) {
          const channelIds = new Set(gone.channels.map((c) => c.id));
          if (conversationsList.activeConversationIdRef.current && channelIds.has(conversationsList.activeConversationIdRef.current)) conversationsList.clearActiveConversation();
          for (const id of channelIds) {
            chatMessages.onConversationDeleted({ t: 'conversation-deleted', conversationId: id });
            callLifecycle.onConversationDeleted(id);
          }
        }
        break;
      }
      case 'server-member-added':
      case 'server-member-removed':
      case 'server-member-updated':
        serversList.onMembersChanged(m);
        break;
      case 'conversation-opened':
        conversationsList.onConversationOpened(m, openConversation);
        requestChatViewRef.current?.(m.conversationId);
        break;
      case 'conversation-created':
        conversationsList.onConversationCreated(m);
        break;
      case 'conversation-updated':
        conversationsList.onConversationUpdated(m);
        break;
      case 'conversation-pinned':
        conversationsList.onConversationPinned(m);
        break;
      case 'conversation-read':
        chatMessages.onConversationRead(m);
        break;
      case 'conversation-history':
        chatMessages.onConversationHistory(m);
        break;
      case 'conversation-history-around':
        chatMessages.onConversationHistoryAround(m);
        break;
      case 'message-search-results':
        messageSearch.onMessageSearchResults(m);
        break;
      case 'conversation-history-more':
        chatMessages.onConversationHistoryMore(m);
        break;
      case 'conversation-history-newer':
        chatMessages.onConversationHistoryNewer(m);
        break;
      case 'chat':
        chatMessages.onChat(m);
        break;
      case 'chat-send-result':
        chatMessages.onChatSendResult(m);
        break;
      case 'chat-action-result':
        chatMessages.onChatActionResult(m);
        break;
      case 'typing':
        typingIndicator.onTyping(m);
        break;
      case 'chat-deleted':
        chatMessages.onChatDeleted(m);
        break;
      case 'chat-edited':
        chatMessages.onChatEdited(m);
        break;
      case 'chat-embeds':
        chatMessages.onChatEmbeds(m);
        break;
      case 'role-updated':
        // an administrator granted or removed this account's admin role while it is connected
        dispatch({ type: 'SET_ROLE', role: m.role });
        break;
      case 'invitation-updated':
        chatMessages.onInvitationUpdated(m);
        break;
      case 'chat-attachment-added':
        chatMessages.onChatAttachmentAdded(m);
        break;
      case 'chat-reaction-updated':
        chatMessages.onChatReactionUpdated(m);
        break;
      case 'conversation-deleted': {
        conversationsList.onConversationDeleted(m);
        chatMessages.onConversationDeleted(m);
        callLifecycle.onConversationDeleted(m.conversationId);
        break;
      }
      case 'social-changed':
        setSocialRevision((n) => n + 1);
        break;
      case 'presence-sync':
        dispatch({ type: 'PARTICIPANTS_SYNC', participants: m.participants });
        presence.setInitial(m.knownUsers, m.onlineUserIds, m.friendIds);
        break;
      case 'user-online':
        presence.onUserOnline(m);
        break;
      case 'user-offline':
        presence.onUserOffline(m);
        break;
      case 'user-deleted':
        presence.onUserDeleted(m);
        break;
      case 'profile-result':
        profileUpdate.handleProfileResult(m);
        break;
      case 'error':
        if (m.code === ERROR_CODES.full) {
          disconnectIntentionally();
          dispatch({ type: 'SET_ROOM_ERROR', message: m.message || i18n.t('room.full') });
        } else if (m.code === ERROR_CODES.client_outdated) {
          log.warn('server refused this build (client_outdated)');
          // stop retrying: every reconnect would get the same answer
          disconnectIntentionally();
          dispatch({ type: 'SET_CLIENT_OUTDATED' });
        } else if (m.code === ERROR_CODES.too_many_connections) {
          disconnectIntentionally();
          dispatch({ type: 'SET_ROOM_ERROR', message: m.message || i18n.t('room.tooManyConnections') });
        } else if (m.code === ERROR_CODES.quota_exceeded || m.code === ERROR_CODES.forbidden || m.code === ERROR_CODES.conflict || m.code === ERROR_CODES.not_found) {
          const started = dmCall.consumeStartAttempt();
          if (started) dispatch({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: started, message: m.message } });
          else setActionError(m.message);
        } else if (m.code === ERROR_CODES['livekit-unavailable']) {
          // also answers a moderator's kick from inside a call, where the call UI is open
          if (!callLifecycle.onCallJoinRejected(m.message)) dispatch({ type: 'SET_SHARE_ERROR', message: m.message });
        } else if (m.code === ERROR_CODES['call-not-allowed'] || m.code === ERROR_CODES.relationship_required) {
          const started = dmCall.consumeStartAttempt();
          if (started) dispatch({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: started, message: m.message } });
          else if (!callLifecycle.onCallJoinRejected(m.message)) log.warn('unhandled server error', { code: m.code, message: m.message, report: true });
        } else if (m.code === ERROR_CODES['message-not-found']) {
          chatMessages.cancelPendingJump();
          messageSearch.setSearchErrorMessage(m.message);
        } else {
          log.warn('unhandled server error', { code: m.code, message: m.message, report: true });
        }
        break;
    }
  }, [
    dispatch, conversationsList, serversList, presence, openConversation, sendWs, callLifecycle, dmCall,
    messageSearch, chatMessages, typingIndicator, disconnectIntentionally, profileUpdate, soundboardEvents, livekitRoom,
  ]);

  const { retryConnection } = useSocketConnection({ socketRef, intentionalCloseRef, sendWs, dispatch, refreshAuth, onMessage: handleServerMessage });

  useEffect(() => {
    preloadSounds();
  }, []);

  useEffect(() => {
    setNotificationClickHandler((conversationId) => {
      openConversation(conversationId);
      requestChatViewRef.current?.(conversationId);
    });
    return () => setNotificationClickHandler(null);
  }, [openConversation]);

  useEffect(() => () => {
    livekitRoom.disconnect();
  }, [livekitRoom]);

  return (
    <RoomContext.Provider
      value={{
        state, dispatch, sendWs, retryConnection, tileDomRegistry, audioRegistry,
        callStageRef, isCallFullscreen, toggleCallFullscreen, fullscreenElement,
        audioUnlocked: callLifecycle.audioUnlocked, deafened: callLifecycle.deafened, toggleDeafened: callLifecycle.toggleDeafened,
        preferMuted: callLifecycle.preferMuted, setPreferMuted: callLifecycle.setPreferMuted,
        reconnecting: callLifecycle.reconnecting,
        livekitRoom, notifyActiveView,
        registerRequestChatView, requestChatView, registerOpenCall, openCall,
        activeCallConversationId: callLifecycle.activeCallConversationId, joinCall: callLifecycle.joinCall, leaveCall: callLifecycle.leaveCall,
        startDmCall: dmCall.startDmCall, acceptDmCall: dmCall.acceptDmCall, declineDmCall: dmCall.declineDmCall, cancelDmCall: dmCall.cancelDmCall,
        dmCall: dmCall.dmCall, dmStartedAt: dmCall.dmStartedAt, dmStageConversationId: dmCall.dmStageConversationId, clearDmStage: dmCall.clearDmStage,
        startSharing, stopSharing, changeSource, pauseSharePreview, resumeSharePreview,
        shareQuality: roomSettings.shareQuality, setShareQuality: roomSettings.setShareQuality,
        startCamera, stopCamera, activateMic, toggleMicMuted,
        updateProfile: profileUpdate.updateProfile, uploadProfileImage: profileUpdate.uploadProfileImage, removeProfileImage: profileUpdate.removeProfileImage,
        menuTarget: tileMenu.menuTarget, openTileMenu: tileMenu.openTileMenu, closeTileMenu: tileMenu.closeTileMenu,
        soundEmojis: soundboardEvents.floatingEmojis,
        showStats: roomSettings.showStats, setShowStats: roomSettings.setShowStats,
        notifyVolume: roomSettings.notifyVolume, setNotifyVolume: roomSettings.setNotifyVolume,
        notificationsEnabled: roomSettings.notificationsEnabled, setNotificationsEnabled: roomSettings.setNotificationsEnabled,
        hideAudioOnlyTiles: roomSettings.hideAudioOnlyTiles, setHideAudioOnlyTiles: roomSettings.setHideAudioOnlyTiles,
        showTileBanners: roomSettings.showTileBanners, setShowTileBanners: roomSettings.setShowTileBanners,
        compressImagesDefault: roomSettings.compressImagesDefault, setCompressImagesDefault: roomSettings.setCompressImagesDefault,
        colorTheme: roomSettings.colorTheme, setColorTheme: roomSettings.setColorTheme,
        mirrorCameraPreview: roomSettings.mirrorCameraPreview, setMirrorCameraPreview: roomSettings.setMirrorCameraPreview,
        conversations: allConversations, activeConversationId: conversationsList.activeConversationId,
        servers: serversList.servers, serverMemberRevision: serversList.memberRevision,
        serverMemberRoleIds: serversList.memberRoleIds, setServerMemberSnapshot: serversList.setMemberSnapshot,
        reorderServers: serversList.reorderLocally,
        openConversation, openDirect: conversationsList.openDirect, closeConversation, pinConversation: conversationsList.pinConversation,
        messagesByConversation: chatMessages.messagesByConversation, hasMoreByConversation: chatMessages.hasMoreByConversation,
        loadingOlderByConversation: chatMessages.loadingOlderByConversation, loadOlderMessages: chatMessages.loadOlderMessages,
        loadNewerMessages: chatMessages.loadNewerMessages, loadingNewerByConversation: chatMessages.loadingNewerByConversation,
        newerCountByConversation: chatMessages.newerCountByConversation,
        windowGenerationByConversation: chatMessages.windowGenerationByConversation,
        unreadByConversation: chatMessages.unreadByConversation,
        unreadStartByConversation: chatMessages.unreadStartByConversation,
        typingByConversation: typingIndicator.typingByConversation, sendTyping: typingIndicator.sendTyping,
        allUsers: presence.allUsers, onlineUserIds: presence.onlineUserIds, friendUserIds: presence.friendUserIds,
        kickFromCall: callLifecycle.kickFromCall, moveToCall: callLifecycle.moveToCall,
        actionError, clearActionError: () => setActionError(null),
        accessNotice, clearAccessNotice: () => setAccessNotice(null),
        socialRevision,
        sendChatMessage: chatMessages.sendChatMessage, deleteChatMessage: chatMessages.deleteChatMessage,
        pendingByConversation: chatMessages.pendingByConversation,
        retryPendingMessage: chatMessages.retryPendingMessage, discardPendingMessage: chatMessages.discardPendingMessage,
        queueMessageWithFiles: chatMessages.queueMessageWithFiles,
        deletingMsgIds: chatMessages.deletingMsgIds, messageActionErrors: chatMessages.messageActionErrors,
        dismissMessageActionError: chatMessages.dismissMessageActionError,
        pendingReactions: chatMessages.pendingReactions,
        editChatMessage: chatMessages.editChatMessage, reactToChatMessage: chatMessages.reactToChatMessage,
        removeChatAttachment: chatMessages.removeChatAttachment, suppressChatEmbed: chatMessages.suppressChatEmbed,
        replyingTo: chatMessages.replyingTo, setReplyingTo: chatMessages.setReplyingTo,
        editingMsgId: chatMessages.editingMsgId, setEditingMsgId: chatMessages.setEditingMsgId,
        reactionParticipantsTarget: chatMessages.reactionParticipantsTarget,
        openReactionParticipants: chatMessages.openReactionParticipants, closeReactionParticipants: chatMessages.closeReactionParticipants,
        hasMoreAfterByConversation: chatMessages.hasMoreAfterByConversation, pendingJumpTarget: chatMessages.pendingJumpTarget,
        clearPendingJumpTarget: chatMessages.clearPendingJumpTarget, jumpToMessage: chatMessages.jumpToMessage,
        searchResults: messageSearch.searchResults, searchLoading: messageSearch.searchLoading, searchError: messageSearch.searchError,
        clearSearchError: messageSearch.clearSearchError, searchMessages: messageSearch.searchMessages,
        maxAttachmentBytes,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}
