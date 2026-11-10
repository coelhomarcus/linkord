import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, RouterProvider, useLocation, useNavigate, useParams } from 'react-router';
import type { CSSProperties } from 'react';
import type { Location } from 'react-router';
import { MotionConfig } from 'motion/react';
import { RoomProvider } from '@/app/providers/RoomProvider';
import { useRoom } from '@/state/RoomContext';
import { AuthProvider, useAuth } from '@/state/AuthContext';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { EmailRequiredModal } from '@/features/auth/EmailRequiredModal';
import { RoomErrorScreen } from '@/app/layout/RoomErrorScreen';
import { OutdatedClientScreen } from '@/app/layout/OutdatedClientScreen';
import { LoadingScreen } from '@/app/layout/LoadingScreen';
import { AccessNotice } from '@/app/layout/AccessNotice';
import { InstallBanner } from '@/features/install/InstallBanner';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { ServerRail } from '@/features/servers/ServerRail';
import { MemberListPanel } from '@/features/servers/MemberListPanel';
import { fetchAllServerMembers } from '@/features/servers/serversApi';
import { DirectProfilePanel } from '@/features/profile/DirectProfilePanel';
import { ServerSettingsProvider } from '@/features/servers/ServerSettingsContext';
import { InvitePage } from '@/features/servers/InvitePage';
import { ServerLanding } from '@/features/servers/ServerLanding';
import { VoiceChannelLobby } from '@/features/servers/VoiceChannelLobby';
import { TopBar } from '@/app/layout/TopBar';
import { FloatingUserDock } from '@/features/navigation/FloatingUserDock';
import { ConversationPanel } from '@/features/conversations/ConversationPanel';
import { ConversationMediaPanel } from '@/features/conversations/ConversationMediaPanel';
import { ChatSearchDialog } from '@/features/chat/ChatSearchDialog';
import { Stage } from '@/features/calls/Stage';
import { DmCallOverlay } from '@/features/calls/DmCallOverlay';
import { CallConnectingScreen } from '@/features/calls/CallConnectingScreen';
import { ParticipantAudioLayer } from '@/features/calls/ParticipantAudioLayer';
import { FloatingPip } from '@/features/calls/FloatingPip';
import { APP_TITLE, callParticipantIds, conversationDocumentTitle, conversationTitle, directUser } from '@/features/conversations/conversationUtils';
import { TileMenu } from '@/features/calls/TileMenu';
import { SoundEmojiOverlay } from '@/features/soundboard/SoundEmojiOverlay';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';
import { EmojiUploadHost } from '@/features/emoji/EmojiUploadHost';
import { StickerEditorHost } from '@/features/stickers/StickerEditorHost';
import { ReactionSheetHost } from '@/features/chat/ReactionSheetHost';
import { ProfileModal } from '@/features/profile/ProfileModal';
import type { ProfileTab } from '@/features/profile/ProfileSidebar';
import { FriendsProvider } from '@/features/friends/FriendsContext';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { SharePage } from '@/features/share/SharePage';
import { sweepExpiredShares } from '@/features/share/sharedPayload';
import { NotificationStateProvider } from '@/features/notifications/NotificationStateProvider';
import { AppBadgeSync } from '@/features/notifications/AppBadgeSync';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { MobileTabBar } from '@/features/navigation/MobileTabBar';
import { RequestsRedirect } from '@/features/friends/RequestsRedirect';
import { AppModals } from '@/app/layout/AppModals';
import {
  AWAITING_OPEN, ROUTES, callConversationIdFromPath, conversationIdFromPath, conversationPath, isChannelsPath, isHomePath, modalForPath, serverIdFromPath,
} from '@/shared/lib/routes';
import { Sheet } from '@/shared/ui/motion/sheet';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { ContentLocationProvider } from '@/shared/lib/contentLocation';
import { createAppRouter } from '@/app/appRouter';
import { useConversationRouteSync } from '@/app/useConversationRouteSync';
import { clearViewportVars, syncViewportVars } from '@/app/viewportVars';
import { chatViewFor } from '@/app/chatView';
import { rightPanelsVisible } from '@/app/rightPanels';
import { isJoiningStage } from '@/app/stageJoin';
import { i18n } from '@/shared/i18n/init';
import { SidebarInset, SidebarProvider } from '@/shared/ui/motion/sidebar';
import { useMemberListOpen } from '@/features/servers/memberListPreference';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';

// where the content area sits when the very first URL already names a modal
// (a refresh on /app/settings/av): behind it, home
const DEFAULT_CONTENT_LOCATION: Location = { pathname: ROUTES.home, search: '', hash: '', state: null, key: 'default' };

/** A link from before servers: a group's id is now its first text channel's,
 * so an old conversation URL still finds what it named. */
function LegacyConversationRedirect() {
  const { conversationId = '' } = useParams();
  const { conversations } = useRoom();
  const conversation = conversations.find((c) => c.id === conversationId);
  return <Navigate to={conversation ? conversationPath(conversation) : ROUTES.home} replace />;
}

/** Where the current entry sits in this tab's history: the browser router
 * keeps it in history.state. Null when the entry did not come from it. */
function currentHistoryIndex(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/** Read the route from the router so same-handler navigation sees the new path. */
function currentPath(): string {
  return router.state.location.pathname;
}

function Shell() {
  const {
    state, dispatch, livekitRoom, closeTileMenu, sendWs, retryConnection, notifyActiveView, registerRequestChatView, registerOpenCall,
    activeCallConversationId, activeConversationId, joinCall, leaveCall, conversations, allUsers, servers,
    dmStageConversationId, clearDmStage, dmCall,
    serverMemberRevision, setServerMemberSnapshot,
  } = useRoom();
  const roomError = state.roomError;
  const navigate = useNavigate();
  const location = useLocation();
  // Settings and administration are modals over the app: while one is open the
  // URL names it, and the page underneath stays the last real page, so the
  // conversation, a running call's stage and the rail do not change behind it.
  const modal = modalForPath(location.pathname);
  const [lastContent, setLastContent] = useState<{ location: Location; historyIndex: number | null } | null>(null);
  if (!modal && lastContent?.location !== location) setLastContent({ location, historyIndex: currentHistoryIndex() });
  const contentLocation = modal ? (lastContent?.location ?? DEFAULT_CONTENT_LOCATION) : location;
  // Closing steps back to the page the modal opened over, past every entry
  // its own sections pushed, so the browser's back (an iPhone edge swipe)
  // never lands on the modal again. Opened straight from a URL, there is
  // nothing to step back to: the page behind takes the modal's place.
  const closeModal = useCallback(() => {
    const here = currentHistoryIndex();
    const behind = lastContent?.historyIndex ?? null;
    if (here !== null && behind !== null && behind < here) {
      navigate(behind - here);
      return;
    }
    navigate(
      { pathname: contentLocation.pathname, search: contentLocation.search, hash: contentLocation.hash },
      { replace: true, state: contentLocation.state },
    );
  }, [navigate, contentLocation, lastContent]);
  const onConversations = isChannelsPath(contentLocation.pathname) || !!callConversationIdFromPath(contentLocation.pathname);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const wide = useMediaQuery('(min-width: 1280px)');
  const [profileTarget, setProfileTarget] = useState<{ userId: string; tab?: ProfileTab } | null>(null);
  const openProfile = useCallback((userId: string, tab?: ProfileTab) => setProfileTarget({ userId, tab }), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [memberListOpen, setMemberListPreference] = useMemberListOpen(wide, contentLocation.pathname);
  // A DM's profile sits beside it unless closed, as in Discord.
  const [profilePanelOpen, setProfilePanelOpen] = useState(true);
  const [mediaOpen, setMediaOpen] = useState(false);
  const pendingStageRef = useRef<string | null>(null);

  useConversationRouteSync();

  // "Show me the chat": from a notification click, possibly while on the
  // friends/settings page. The router's current path (not the hook's
  // pathname) on purpose: callers navigate() explicitly in the same handler
  // just before this, and only the router's own state is already up to date then.
  useEffect(() => {
    registerRequestChatView((conversationId?: string) => {
      const conversation = conversationId ? conversationsRef.current.find((c) => c.id === conversationId) : undefined;
      if (conversationId) navigate(conversation ? conversationPath(conversation) : ROUTES.direct(conversationId));
      else if (!isHomePath(currentPath())) navigate(ROUTES.home, AWAITING_OPEN);
    });
  }, [registerRequestChatView, navigate]);

  const publishing = state.me.sharing || state.me.cameraOn;

  // Not tied to having a published mic: joining with no mic plugged in (or
  // mic permission blocked) still has to show the call and play everyone else.
  const inCall = !!activeCallConversationId;

  const callIds = useMemo(
    () => callParticipantIds(state.me.id, state.participants, activeCallConversationId),
    [activeCallConversationId, state.me.id, state.participants]
  );

  /** Where a call shows: a voice channel's own URL, or the DM the call belongs to. */
  function stagePath(conversationId: string): string {
    const conversation = conversationsRef.current.find((c) => c.id === conversationId);
    if (conversation?.type === 'voice' && conversation.serverId) return ROUTES.channel(conversation.serverId, conversation.id);
    if (conversation?.type === 'direct') return ROUTES.direct(conversation.id);
    return ROUTES.call(conversationId);
  }

  function handleOpenCall(conversationId: string) {
    pendingStageRef.current = conversationId;
    joinCall(conversationId);
    navigate(stagePath(conversationId), { state: { from: currentPath() } });
  }

  useEffect(() => {
    if (!dmStageConversationId) return;
    pendingStageRef.current = dmStageConversationId;
    navigate(stagePath(dmStageConversationId), { state: { from: currentPath() } });
    clearDmStage();
  }, [dmStageConversationId, navigate, clearDmStage]);

  // re-registered every render: the handler closes over the current location
  useEffect(() => { registerOpenCall(handleOpenCall); });

  // Jump back to the Stage from wherever you wandered off to — used by both
  // FloatingPip (clicking it) and the sidebar CallDock title.
  function handleReturnToCall() {
    if (activeCallConversationId) navigate(stagePath(activeCallConversationId), { state: { from: currentPath() } });
  }

  // Navigation never ends a call; only its own route shows the stage — a DM
  // call's page, or the voice channel's URL (which shows a lobby when you
  // aren't in it).
  const dmStageId = callConversationIdFromPath(contentLocation.pathname);
  const pathConversation = conversations.find((c) => c.id === conversationIdFromPath(contentLocation.pathname));
  const voiceChannelOnPath = pathConversation?.type === 'voice' ? pathConversation : null;
  const stageConversationId = dmStageId ?? voiceChannelOnPath?.id ?? null;
  const showStage = !!stageConversationId && stageConversationId === activeCallConversationId;
  const viewingDmCall = pathConversation?.type === 'direct' && pathConversation.id === activeCallConversationId;
  const leaveStagePath = (id: string) => (voiceChannelOnPath ? ROUTES.server(voiceChannelOnPath.serverId!) : ROUTES.direct(id));
  useEffect(() => {
    if (showStage && pendingStageRef.current === stageConversationId) pendingStageRef.current = null;
    if (dmCall?.phase === 'ended' && pendingStageRef.current === dmStageId) pendingStageRef.current = null;
    // a voice channel without its call is the lobby, not somewhere to leave
    if (!dmStageId || !state.joined || showStage) return;
    if (pendingStageRef.current === dmStageId && state.callJoinError?.conversationId !== dmStageId) return;
    pendingStageRef.current = null;
    navigate(ROUTES.direct(dmStageId), { replace: true });
  }, [dmStageId, stageConversationId, showStage, state.joined, state.callJoinError, navigate, dmCall]);
  // A moderator's move lands this connection in another channel's call
  // without it navigating anywhere: whoever was watching the old channel's
  // stage follows the call to the new one instead of being left at a lobby.
  const lastCallIdRef = useRef<string | null>(null);
  const voiceChannelOnPathId = voiceChannelOnPath?.id ?? null;
  useEffect(() => {
    if (!activeCallConversationId) return;
    const last = lastCallIdRef.current;
    lastCallIdRef.current = activeCallConversationId;
    if (!last || last === activeCallConversationId || voiceChannelOnPathId !== last) return;
    const moved = conversationsRef.current.find((c) => c.id === activeCallConversationId);
    if (moved?.type === 'voice' && moved.serverId) navigate(ROUTES.channel(moved.serverId, moved.id), { replace: true });
  }, [activeCallConversationId, voiceChannelOnPathId, navigate]);
  const joinFailedId = state.callJoinError?.conversationId ?? null;
  useEffect(() => {
    if (!stageConversationId || showStage || pendingStageRef.current !== stageConversationId || joinFailedId === stageConversationId) return;
    const timeout = window.setTimeout(() => {
      pendingStageRef.current = null;
      dispatch({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: stageConversationId, message: i18n.t('calls:errors.joinTimeout') } });
      void leaveCall();
      if (dmStageId) navigate(ROUTES.direct(dmStageId), { replace: true });
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [stageConversationId, dmStageId, showStage, joinFailedId, dispatch, leaveCall, navigate]);
  function cancelPendingCall() {
    const joiningThisCall = !!stageConversationId && pendingStageRef.current === stageConversationId;
    pendingStageRef.current = null;
    if (joiningThisCall) void leaveCall();
    navigate(stageConversationId ? leaveStagePath(stageConversationId) : ROUTES.home, { replace: true });
  }
  const joiningStage = isJoiningStage({ stageConversationId, pendingConversationId: pendingStageRef.current, failedConversationId: joinFailedId });
  // what the user is looking at, not the last view picked. The call's side
  // chat is the conversation on screen: a message arriving then was seen.
  const visibleConversationId = voiceChannelOnPath ? null : conversationIdFromPath(contentLocation.pathname);
  const chatView = chatViewFor({ stageShown: showStage, visibleConversationId, activeConversationId });
  useEffect(() => { notifyActiveView(chatView); }, [chatView, notifyActiveView]);

  const activeConversation = conversations.find((conversation) => conversation.id === (visibleConversationId ?? stageConversationId ?? activeConversationId));
  const currentServer = servers.find((s) => s.id === serverIdFromPath(contentLocation.pathname)) ?? null;
  const roleDataServerId = activeConversation?.serverId ?? currentServer?.id ?? null;
  const roleDataRevision = roleDataServerId ? serverMemberRevision.get(roleDataServerId) ?? 0 : 0;
  useEffect(() => {
    if (!roleDataServerId) return;
    let cancelled = false;
    fetchAllServerMembers(roleDataServerId)
      .then((members) => {
        if (!cancelled) setServerMemberSnapshot(roleDataServerId, members.map((member) => ({ userId: member.user.id, roleIds: member.roleIds })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roleDataServerId, roleDataRevision, setServerMemberSnapshot]);
  const shownType = visibleConversationId ? activeConversation?.type ?? null : null;
  const directShown = shownType === 'direct';
  const { details: detailsVisible, media: mediaVisible } = rightPanelsVisible({
    detailsOpen: directShown ? profilePanelOpen && wide : memberListOpen, mediaOpen, onChatPage: !!visibleConversationId, stageShown: showStage, conversationType: shownType,
  });
  const membersVisible = detailsVisible && !directShown;
  const profileVisible = detailsVisible && directShown;
  const profilePanelUser = profileVisible ? directUser(activeConversation, state.me.userId, allUsers) : null;
  const setDetails = (open: boolean) => (directShown ? setProfilePanelOpen(open) : setMemberListPreference(open));
  const activeConversationName = conversationTitle(activeConversation, state.me.userId, allUsers);

  const tabTitle = onConversations || showStage ? conversationDocumentTitle(activeConversation, state.me.userId, allUsers, currentServer?.name) : APP_TITLE;
  // the pages a phone reaches from its tab bar (the column pages count: home and a server's channel list)
  const mobileListPage = contentLocation.pathname === ROUTES.home || (!!currentServer && !conversationIdFromPath(contentLocation.pathname));
  const mobileMainPage = mobileListPage || contentLocation.pathname === ROUTES.friends || contentLocation.pathname === ROUTES.notifications || contentLocation.pathname === ROUTES.profile;
  useEffect(() => {
    document.title = tabTitle;
    return () => { document.title = APP_TITLE; };
  }, [tabTitle]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (publishing) { e.preventDefault(); e.returnValue = ''; }
    }
    function onPageHide() {
      sendWs({ t: 'leave' });
      livekitRoom.disconnect();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (closeTileMenu()) return;
      if (state.focusedId) dispatch({ type: 'SET_FOCUSED', id: null, origin: 'manual' });
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [publishing, livekitRoom, closeTileMenu, state.focusedId, dispatch, sendWs]);

  if (state.clientOutdated) return <OutdatedClientScreen />;
  if (roomError) return <RoomErrorScreen message={roomError} />;
  if (!state.joined) return <LoadingScreen reconnecting={state.reconnecting} onRetry={retryConnection} />;

  return (
    <GlobalContextMenu onOpenProfile={openProfile}>
      <ContentLocationProvider value={contentLocation}>
      <ServerSettingsProvider onOpenProfile={openProfile}>
      <div className="flex h-full min-h-0 flex-col bg-surface-rail">
      <TopBar className="hidden md:flex" title={tabTitle === APP_TITLE ? undefined : activeConversationName} server={currentServer} />
      <SidebarProvider
        className="relative min-h-0 flex-1 bg-surface-rail text-text-primary [--surface-base:var(--color-surface-app)] max-md:pt-[env(safe-area-inset-top)]"
        style={{ minHeight: 0, '--sidebar-width': 'var(--spacing-sidebar)', '--sidebar-width-mobile': '24rem', '--sidebar-overlay-offset': '4.5rem', '--mobile-navigation-height': `calc(4rem + var(--safe-bottom) + ${inCall ? '3rem' : '0rem'})` } as CSSProperties}
      >
        <DmCallOverlay />
        <AccessNotice />
        <InstallBanner />
        <ServerRail className="hidden md:flex" />
        {/* Discord's one framed panel: the list and the content side by side
            under a shared hairline, rounded once at its top-left corner */}
        <div className="flex min-h-0 min-w-0 flex-1 md:overflow-hidden md:rounded-tl-[12px] md:border-l md:border-t md:border-border-subtle">
        <ConversationSidebar onOpenProfile={openProfile} />
        <SidebarInset className={`relative min-h-0 overflow-hidden bg-surface-panel [--surface-base:var(--color-surface-panel)] ${mobileListPage ? 'max-md:hidden' : ''} ${mobileMainPage ? 'max-md:pb-[var(--mobile-navigation-height)]' : ''}`}>
          <div className="flex h-full min-h-0">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Routes location={contentLocation}>
            <Route path={ROUTES.home} element={<FriendsPage onOpenProfile={openProfile} />} />
            <Route path={ROUTES.friends} element={<FriendsPage onOpenProfile={openProfile} />} />
            <Route path="/app/channels" element={<Navigate to={ROUTES.home} replace />} />
            <Route path="/app/channels/:serverId" element={<ServerLanding />} />
            <Route
              path="/app/channels/:serverId/:conversationId"
              element={voiceChannelOnPath ? (
                showStage
                  ? <Stage allIds={callIds} onBack={() => navigate(ROUTES.server(voiceChannelOnPath.serverId!))} />
                  : joiningStage ? <CallConnectingScreen onCancel={cancelPendingCall} /> : <VoiceChannelLobby channel={voiceChannelOnPath} onJoin={() => handleOpenCall(voiceChannelOnPath.id)} />
              ) : (
                <ConversationPanel
                  onOpenProfile={openProfile}
                  onOpenCall={handleOpenCall}
                  onOpenSearch={() => setSearchOpen(true)}
                  detailsOpen={directShown ? profileVisible : memberListOpen}
                  mediaOpen={mediaVisible}
                  onOpenDetails={() => { setDetails(true); }}
                  onToggleDetails={() => { setDetails(directShown ? !(membersVisible || profileVisible) : !memberListOpen); }}
                  onToggleMedia={() => { setMediaOpen(!mediaVisible); }}
                />
              )}
            />
            <Route path="/app/calls/:conversationId" element={dmStageId ? <Navigate to={ROUTES.direct(dmStageId)} replace /> : <Navigate to={ROUTES.home} replace />} />
            <Route path="/invite/:code" element={<InvitePage />} />
            <Route path={ROUTES.notifications} element={<NotificationsPage />} />
            <Route path={ROUTES.share} element={<SharePage />} />
            <Route path={ROUTES.profile} element={<ProfilePage onOpenProfile={openProfile} />} />
            <Route path={ROUTES.requests} element={<RequestsRedirect />} />
            <Route path="/app/conversations/:conversationId" element={<LegacyConversationRedirect />} />
            <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
          </Routes>
          </div>
          {membersVisible && currentServer && wide && <MemberListPanel server={currentServer} onOpenProfile={openProfile} />}
          {profilePanelUser && <DirectProfilePanel user={profilePanelUser} onOpenProfile={openProfile} />}
          </div>
          {inCall && <ParticipantAudioLayer participantIds={callIds} />}
          {inCall && !showStage && !viewingDmCall && (
            <FloatingPip
              allIds={callIds}
              onExpand={handleReturnToCall}
              hideOnMobile={mobileMainPage}
            />
          )}
          <SoundEmojiOverlay />
        </SidebarInset>
        </div>
        <FloatingUserDock
          placement="shell"
          onReturnToCall={handleReturnToCall}
          onOpenProfile={openProfile}
        />
        {mobileMainPage && <MobileTabBar activeCallConversationId={activeCallConversationId} onReturnToCall={handleReturnToCall} />}
        {currentServer && !wide && (
          <Sheet open={membersVisible} onOpenChange={setMemberListPreference} side="right" ariaLabel={currentServer.name} className="w-[264px]">
            <MemberListPanel server={currentServer} onOpenProfile={openProfile} active={membersVisible} />
          </Sheet>
        )}
        <ConversationMediaPanel
          conversationId={activeConversation?.id ?? null}
          open={mediaVisible}
          onOpenChange={setMediaOpen}
        />
        <TileMenu onOpenProfile={openProfile} />
        <ProfileModal userId={profileTarget?.userId ?? null} initialTab={profileTarget?.tab} onClose={() => setProfileTarget(null)} onOpenProfile={openProfile} />
        <AppModals modal={modal} onClose={closeModal} onOpenProfile={openProfile} />
        <EmojiUploadHost />
        <StickerEditorHost />
        <ReactionSheetHost />
        <ChatSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          activeConversationId={activeConversationId}
          activeConversationName={activeConversationName}
        />
      </SidebarProvider>
      </div>
      </ServerSettingsProvider>
      </ContentLocationProvider>
    </GlobalContextMenu>
  );
}

function AuthGate() {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'anon' || !user) return <AuthScreen />;
  if (!user.email) return <EmailRequiredModal />;
  return (
    <RoomProvider key={user.id}>
      <FriendsProvider>
        <NotificationStateProvider><AppBadgeSync /><Shell /></NotificationStateProvider>
      </FriendsProvider>
    </RoomProvider>
  );
}

// The router sits ABOVE the auth gate but only its <Routes> (inside Shell)
// ever swap — RoomProvider, and with it the LiveKit call, never remounts on
// navigation.
function AppProviders() {
  const navigate = useNavigate();
  useEffect(() => {
    const viewport = window.visualViewport;
    const mobile = window.matchMedia('(max-width: 767px)');
    if (!viewport) return;
    const root = document.documentElement.style;
    const syncHeight = () => syncViewportVars(root, viewport, window.innerHeight, mobile.matches);
    syncHeight();
    viewport.addEventListener('resize', syncHeight);
    viewport.addEventListener('scroll', syncHeight);
    mobile.addEventListener('change', syncHeight);
    return () => {
      viewport.removeEventListener('resize', syncHeight);
      viewport.removeEventListener('scroll', syncHeight);
      mobile.removeEventListener('change', syncHeight);
      clearViewportVars(root);
    };
  }, []);
  useEffect(() => { void sweepExpiredShares(); }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onPushNavigation = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; path?: unknown } | null;
      if (data?.type !== 'linkord-push-navigation' || typeof data.path !== 'string' || !data.path.startsWith('/app/')) return;
      navigate(data.path);
    };
    navigator.serviceWorker.addEventListener('message', onPushNavigation);
    return () => navigator.serviceWorker.removeEventListener('message', onPushNavigation);
  }, [navigate]);
  // "user": with reduced motion asked for, Motion drops transforms and layout moves and keeps fades, the
  // same rule styles/index.css applies to the CSS animations
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <TooltipProvider>
          <AuthGate />
        </TooltipProvider>
      </AuthProvider>
    </MotionConfig>
  );
}

// The data router provides browser history and the settings draft blocker.
const router = createAppRouter([{ path: '*', element: <AppProviders /> }]);

export function App() {
  return <RouterProvider router={router} />;
}
