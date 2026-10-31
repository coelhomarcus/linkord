import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, RouterProvider, useLocation, useNavigate } from 'react-router';
import type { CSSProperties } from 'react';
import type { Location } from 'react-router';
import { RoomProvider } from '@/app/providers/RoomProvider';
import { useRoom } from '@/state/RoomContext';
import { AuthProvider, useAuth } from '@/state/AuthContext';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { EmailRequiredModal } from '@/features/auth/EmailRequiredModal';
import { RoomErrorScreen } from '@/app/layout/RoomErrorScreen';
import { OutdatedClientScreen } from '@/app/layout/OutdatedClientScreen';
import { LoadingScreen } from '@/app/layout/LoadingScreen';
import { ReconnectBanner } from '@/app/layout/ReconnectBanner';
import { AccessNotice } from '@/app/layout/AccessNotice';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { AppNavigationRail } from '@/features/navigation/AppNavigationRail';
import { FloatingUserDock } from '@/features/navigation/FloatingUserDock';
import { ConversationPanel } from '@/features/conversations/ConversationPanel';
import { GroupDetailsPanel } from '@/features/conversations/GroupDetailsPanel';
import { ConversationMediaPanel } from '@/features/conversations/ConversationMediaPanel';
import { ChatSearchDialog } from '@/features/chat/ChatSearchDialog';
import { Stage } from '@/features/calls/Stage';
import { CallConnectingScreen } from '@/features/calls/CallConnectingScreen';
import { CallChatPanel } from '@/features/calls/CallChatPanel';
import { ParticipantAudioLayer } from '@/features/calls/ParticipantAudioLayer';
import { FloatingPip } from '@/features/calls/FloatingPip';
import { APP_TITLE, callParticipantIds, conversationDocumentTitle, conversationTitle } from '@/features/conversations/conversationUtils';
import { TileMenu } from '@/features/calls/TileMenu';
import { ReactionsOverlay } from '@/features/reactions/ReactionsOverlay';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';
import { ProfileModal } from '@/features/profile/ProfileModal';
import { FriendsProvider } from '@/features/friends/FriendsContext';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { NotificationStateProvider } from '@/features/notifications/NotificationStateProvider';
import { AppBadgeSync } from '@/features/notifications/AppBadgeSync';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { MobileTabBar } from '@/features/navigation/MobileTabBar';
import { RequestsRedirect } from '@/features/friends/RequestsRedirect';
import { AppModals } from '@/app/layout/AppModals';
import { AWAITING_OPEN, ROUTES, callConversationIdFromPath, conversationIdFromPath, isConversationsPath, modalForPath } from '@/shared/lib/routes';
import { ContentLocationProvider } from '@/shared/lib/contentLocation';
import { createAppRouter } from '@/app/appRouter';
import { useConversationRouteSync } from '@/app/useConversationRouteSync';
import { clearViewportVars, syncViewportVars } from '@/app/viewportVars';
import { chatViewFor } from '@/app/chatView';
import { rightPanelsVisible } from '@/app/rightPanels';
import { SidebarInset, SidebarProvider } from '@/shared/ui/motion/sidebar';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '@/shared/hooks/useSidebarCollapsedPreference';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';

// where the content area sits when the very first URL already names a modal
// (a refresh on /app/settings/av): behind it, the conversations
const DEFAULT_CONTENT_LOCATION: Location = { pathname: ROUTES.conversations, search: '', hash: '', state: null, key: 'default' };

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
    state, dispatch, livekitRoom, closeTileMenu, sendWs, retryConnection, notifyActiveView, registerRequestChatView,
    activeCallConversationId, activeConversationId, joinCall, leaveCall, conversations, allUsers,
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
  const onConversations = isConversationsPath(contentLocation.pathname) || !!callConversationIdFromPath(contentLocation.pathname);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mobileShowSidebar, setMobileShowSidebar] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [callChatOpen, setCallChatOpen] = useState(false);
  const pendingStageRef = useRef<string | null>(null);

  const [sidebarOpen, setSidebarOpenState] = useState(() => !loadSidebarCollapsed());
  const setSidebarOpen = useCallback((next: boolean) => {
    setSidebarOpenState(next);
    saveSidebarCollapsed(!next);
  }, []);

  useConversationRouteSync();

  // "Show me the chat": from a notification click, possibly while on the
  // friends/settings page. The router's current path (not the hook's
  // pathname) on purpose: callers navigate() explicitly in the same handler
  // just before this, and only the router's own state is already up to date then.
  useEffect(() => {
    registerRequestChatView((conversationId?: string) => {
      if (conversationId) navigate(ROUTES.conversation(conversationId));
      else if (!isConversationsPath(currentPath())) navigate(ROUTES.conversations, AWAITING_OPEN);
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

  function handleOpenCall(conversationId: string) {
    pendingStageRef.current = conversationId;
    joinCall(conversationId);
    navigate(ROUTES.call(conversationId), { state: { from: currentPath() } });
  }

  // Jump back to the Stage from wherever you wandered off to — used by both
  // FloatingPip (clicking it) and the sidebar CallDock title.
  function handleReturnToCall() {
    if (activeCallConversationId) navigate(ROUTES.call(activeCallConversationId), { state: { from: currentPath() } });
  }

  // Navigation never ends a call; only its own route shows the stage.
  const stageConversationId = callConversationIdFromPath(contentLocation.pathname);
  const showStage = !!stageConversationId && stageConversationId === activeCallConversationId;
  useEffect(() => {
    if (showStage && pendingStageRef.current === stageConversationId) pendingStageRef.current = null;
    if (!stageConversationId || !state.joined || showStage) return;
    if (pendingStageRef.current === stageConversationId && state.callJoinError?.conversationId !== stageConversationId) return;
    pendingStageRef.current = null;
    navigate(ROUTES.conversation(stageConversationId), { replace: true });
  }, [stageConversationId, showStage, state.joined, state.callJoinError, navigate]);
  useEffect(() => {
    if (!stageConversationId || showStage || pendingStageRef.current !== stageConversationId) return;
    const timeout = window.setTimeout(() => {
      pendingStageRef.current = null;
      dispatch({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: stageConversationId, message: 'A chamada demorou para conectar. Tente novamente.' } });
      void leaveCall();
      navigate(ROUTES.conversation(stageConversationId), { replace: true });
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [stageConversationId, showStage, dispatch, leaveCall, navigate]);
  function cancelPendingCall() {
    const joiningThisCall = !!stageConversationId && pendingStageRef.current === stageConversationId;
    pendingStageRef.current = null;
    if (joiningThisCall) void leaveCall();
    navigate(stageConversationId ? ROUTES.conversation(stageConversationId) : ROUTES.conversations, { replace: true });
  }
  // what the user is looking at, not the last view picked. The call's side
  // chat is the conversation on screen: a message arriving then was seen.
  const visibleConversationId = conversationIdFromPath(contentLocation.pathname);
  const callChatShown = callChatOpen && !!activeCallConversationId && conversations.some((conversation) => conversation.id === activeCallConversationId);
  const chatView = chatViewFor({ stageShown: showStage, callChatShown, visibleConversationId, activeConversationId });
  useEffect(() => { notifyActiveView(chatView); }, [chatView, notifyActiveView]);

  const activeConversation = conversations.find((conversation) => conversation.id === (visibleConversationId ?? stageConversationId ?? activeConversationId));
  const hasDetails = activeConversation?.type === 'group' || activeConversation?.type === 'bot';
  const { details: detailsVisible, media: mediaVisible } = rightPanelsVisible({
    detailsOpen, mediaOpen, onChatPage: onConversations, stageShown: showStage, conversationType: activeConversation?.type ?? null,
  });
  const activeConversationName = conversationTitle(activeConversation, state.me.userId, allUsers);

  const tabTitle = onConversations || showStage ? conversationDocumentTitle(activeConversation, state.me.userId, allUsers) : APP_TITLE;
  const mobileMainPage = contentLocation.pathname === ROUTES.conversations || contentLocation.pathname === ROUTES.friends || contentLocation.pathname === ROUTES.notifications || contentLocation.pathname === ROUTES.profile;
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
    <GlobalContextMenu onOpenProfile={setProfileUserId}>
      <ContentLocationProvider value={contentLocation}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        openMobile={mobileShowSidebar}
        onOpenMobileChange={setMobileShowSidebar}
        className="relative h-full bg-bg-primary text-text-primary [--surface-base:var(--color-surface-app)] max-md:pt-[env(safe-area-inset-top)]"
        style={{ minHeight: 0, '--sidebar-width': '20rem', '--sidebar-width-mobile': '24rem', '--sidebar-overlay-offset': '4rem', '--mobile-navigation-height': `calc(4rem + var(--safe-bottom) + ${inCall ? '3rem' : '0rem'})` } as CSSProperties}
      >
        <ReconnectBanner />
        <AccessNotice />
        <AppNavigationRail className="hidden md:flex" />
        <ConversationSidebar />
        <FloatingUserDock
          placement="shell"
          onReturnToCall={handleReturnToCall}
          onOpenProfile={setProfileUserId}
          showReturnToCall={!showStage}
        />
        <SidebarInset className={`relative min-h-0 overflow-hidden bg-surface-panel [--surface-base:var(--color-surface-panel)] md:m-shell md:rounded-xl md:border md:border-border ${contentLocation.pathname === ROUTES.conversations ? 'max-md:hidden' : ''} ${mobileMainPage ? 'max-md:pb-[var(--mobile-navigation-height)]' : ''}`}>
          <Routes location={contentLocation}>
            <Route
              path="/app/conversations/:conversationId?"
              element={
                <ConversationPanel
                  onOpenProfile={setProfileUserId}
                  onOpenCall={handleOpenCall}
                  onOpenSearch={() => setSearchOpen(true)}
                  detailsOpen={detailsVisible}
                  mediaOpen={mediaVisible}
                  onOpenDetails={() => { setMediaOpen(false); setDetailsOpen(true); }}
                  onToggleDetails={() => { setMediaOpen(false); setDetailsOpen(!detailsVisible); }}
                  onToggleMedia={() => { setDetailsOpen(false); setMediaOpen(!mediaVisible); }}
                />
              }
            />
            <Route path="/app/calls/:conversationId" element={stageConversationId ? (
              showStage
                ? <Stage allIds={callIds} chatOpen={callChatOpen} onToggleChat={() => setCallChatOpen((v) => !v)} onBack={() => { if ((contentLocation.state as { from?: unknown } | null)?.from) navigate(-1); else navigate(ROUTES.conversations, { replace: true }); }} />
                : <CallConnectingScreen onCancel={cancelPendingCall} />
            ) : <Navigate to={ROUTES.conversations} replace />} />
            <Route path={ROUTES.friends} element={<FriendsPage onOpenProfile={setProfileUserId} />} />
            <Route path={ROUTES.notifications} element={<NotificationsPage />} />
            <Route path={ROUTES.profile} element={<ProfilePage onOpenProfile={setProfileUserId} />} />
            <Route path={ROUTES.requests} element={<RequestsRedirect />} />
            <Route path="*" element={<Navigate to={ROUTES.conversations} replace />} />
          </Routes>
          {inCall && <ParticipantAudioLayer participantIds={callIds} />}
          {inCall && !showStage && (
            <FloatingPip
              allIds={callIds}
              onExpand={handleReturnToCall}
              hideOnMobile={mobileMainPage}
            />
          )}
          <ReactionsOverlay />
        </SidebarInset>
        {mobileMainPage && <MobileTabBar activeCallConversationId={activeCallConversationId} onReturnToCall={handleReturnToCall} />}
        <GroupDetailsPanel
          conversationId={hasDetails && activeConversation ? activeConversation.id : null}
          open={detailsVisible}
          onOpenChange={setDetailsOpen}
          onOpenProfile={setProfileUserId}
          // over the details, not instead of them: closing the media goes back to them
          onOpenMedia={() => setMediaOpen(true)}
          onOpenSearch={() => { setDetailsOpen(false); setSearchOpen(true); }}
        />
        <ConversationMediaPanel
          conversationId={activeConversation?.id ?? null}
          open={mediaVisible}
          onOpenChange={setMediaOpen}
        />
        <CallChatPanel
          conversationId={activeCallConversationId}
          open={callChatOpen && showStage}
          onOpenChange={setCallChatOpen}
          onOpenProfile={setProfileUserId}
        />
        <TileMenu onOpenProfile={setProfileUserId} />
        <ProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} onOpenProfile={setProfileUserId} />
        <AppModals modal={modal} onClose={closeModal} onOpenProfile={setProfileUserId} />
        <ChatSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          activeConversationId={activeConversationId}
          activeConversationName={activeConversationName}
        />
      </SidebarProvider>
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
  return (
    <AuthProvider>
      <TooltipProvider>
        <AuthGate />
      </TooltipProvider>
    </AuthProvider>
  );
}

// The data router provides browser history and the settings draft blocker.
const router = createAppRouter([{ path: '*', element: <AppProviders /> }]);

export function App() {
  return <RouterProvider router={router} />;
}
