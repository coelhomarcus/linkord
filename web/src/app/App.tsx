import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, RouterProvider, useLocation, useNavigate } from 'react-router';
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
import { CallChatPanel } from '@/features/calls/CallChatPanel';
import { ParticipantAudioLayer } from '@/features/calls/ParticipantAudioLayer';
import { FloatingPip } from '@/features/calls/FloatingPip';
import { callParticipantIds, conversationTitle } from '@/features/conversations/conversationUtils';
import { TileMenu } from '@/features/calls/TileMenu';
import { ReactionsOverlay } from '@/features/reactions/ReactionsOverlay';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';
import { ProfileModal } from '@/features/profile/ProfileModal';
import { FriendsProvider } from '@/features/friends/FriendsContext';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { RequestsRedirect } from '@/features/friends/RequestsRedirect';
import { AppModals } from '@/app/layout/AppModals';
import { AWAITING_OPEN, ROUTES, conversationNav, isConversationsPath, modalForPath } from '@/shared/lib/routes';
import { ContentLocationProvider } from '@/shared/lib/contentLocation';
import { createAppRouter } from '@/app/appRouter';
import { setLogRoute } from '@/shared/lib/logger';
import { useConversationRouteSync } from '@/app/useConversationRouteSync';
import { rightPanelsVisible } from '@/app/rightPanels';
import { SidebarInset, SidebarProvider } from '@/shared/ui/motion/sidebar';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '@/shared/hooks/useSidebarCollapsedPreference';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';

// where the content area sits when the very first URL already names a modal
// (a refresh on /app/settings/av): behind it, the conversations
const DEFAULT_CONTENT_LOCATION: Location = { pathname: ROUTES.conversations, search: '', hash: '', state: null, key: 'default' };

/** The route the app is on right now. Read from the router, not from the
 * address bar (which never changes), and up to date as soon as a navigate()
 * has run, which is what the handlers that navigate and then ask need. */
function currentPath(): string {
  return router.state.location.pathname;
}

function Shell() {
  const {
    state, dispatch, livekitRoom, closeTileMenu, sendWs, notifyActiveView, registerRequestChatView,
    activeCallConversationId, activeConversationId, joinCall, conversations, allUsers,
  } = useRoom();
  const [activeView, setActiveView] = useState<'chat' | 'call'>('chat');
  const roomError = state.roomError;
  const navigate = useNavigate();
  const location = useLocation();
  // Settings and administration are modals over the app: while one is open the
  // URL names it, and the page underneath stays the last real page, so the
  // conversation, a running call's stage and the rail do not change behind it.
  const modal = modalForPath(location.pathname);
  const [lastContent, setLastContent] = useState<Location | null>(null);
  if (!modal && lastContent !== location) setLastContent(location);
  const contentLocation = modal ? (lastContent ?? DEFAULT_CONTENT_LOCATION) : location;
  // closing puts the page behind the modal back in the modal's place
  const closeModal = useCallback(() => {
    navigate(
      { pathname: contentLocation.pathname, search: contentLocation.search, hash: contentLocation.hash },
      { replace: true, state: contentLocation.state },
    );
  }, [navigate, contentLocation]);
  const onConversations = isConversationsPath(contentLocation.pathname);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // Landing straight on a page (a deep link, a refresh on /app/friends) should
  // show that page — the sidebar sheet is only the landing screen when the URL
  // names no page at all.
  // only on a phone: from 768px the rail is on screen and the drawer opens on demand
  const [mobileShowSidebar, setMobileShowSidebar] = useState(() => {
    const path = currentPath().replace(/\/$/, '');
    return window.matchMedia('(max-width: 767px)').matches && (path === '' || path === '/app' || path === ROUTES.conversations);
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [callChatOpen, setCallChatOpen] = useState(false);

  const [sidebarOpen, setSidebarOpenState] = useState(() => !loadSidebarCollapsed());
  const setSidebarOpen = useCallback((next: boolean) => {
    setSidebarOpenState(next);
    saveSidebarCollapsed(!next);
  }, []);

  // The first conversation auto-selected right after connecting shouldn't
  // drill in on mobile (the sidebar list is the intended landing screen).
  // Every LATER change to activeConversationId is a
  // real navigation the user should actually see: a group they just
  // created, a notification click, or anything else that opens a
  // conversation without going through the sidebar row's own onClick (which
  // already closes the mobile sheet directly). Without this, those left the
  // active conversation switched behind an unchanged, still-open sidebar.
  const hasAutoSelectedInitialConversationRef = useRef(false);
  useEffect(() => {
    if (!activeConversationId) return;
    if (!hasAutoSelectedInitialConversationRef.current) {
      hasAutoSelectedInitialConversationRef.current = true;
      return;
    }
    setMobileShowSidebar(false);
  }, [activeConversationId]);

  useConversationRouteSync();

  // "Show me the chat": from a notification click, possibly while on the
  // friends/settings page. The router's current path (not the hook's
  // pathname) on purpose: callers navigate() explicitly in the same handler
  // just before this, and only the router's own state is already up to date then.
  useEffect(() => {
    registerRequestChatView(() => {
      setActiveView('chat');
      if (!isConversationsPath(currentPath())) navigate(ROUTES.conversations, AWAITING_OPEN);
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
    joinCall(conversationId);
    setActiveView('call');
    setMobileShowSidebar(false);
    if (!isConversationsPath(currentPath())) navigate(ROUTES.conversations, conversationNav(conversationId));
  }

  // Jump back to the Stage from wherever you wandered off to — used by both
  // FloatingPip (clicking it) and the sidebar CallDock title.
  function handleReturnToCall() {
    setActiveView('call');
    if (!onConversations) navigate(ROUTES.conversations, activeCallConversationId ? conversationNav(activeCallConversationId) : undefined);
  }

  // The call stage only ever shows on the conversations page. Elsewhere the
  // call keeps running (audio, PiP) — navigating never ends it.
  const showStage = onConversations && activeView === 'call' && inCall;
  // what the user is looking at, not the last view picked: the stage, the chat,
  // or another page with the conversation still active behind it — only the
  // chat on screen makes a message arriving there read
  const chatView = showStage ? 'call' : onConversations ? 'chat' : 'away';
  useEffect(() => { notifyActiveView(chatView); }, [chatView, notifyActiveView]);

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const hasDetails = activeConversation?.type === 'group' || activeConversation?.type === 'bot';
  const { details: detailsVisible, media: mediaVisible } = rightPanelsVisible({
    detailsOpen, mediaOpen, onChatPage: onConversations, stageShown: showStage, conversationType: activeConversation?.type ?? null,
  });
  const activeConversationName = conversationTitle(activeConversation, state.me.userId, allUsers);

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
  if (!state.joined) return <LoadingScreen />;

  return (
    <GlobalContextMenu onOpenProfile={setProfileUserId}>
      <ContentLocationProvider value={contentLocation}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        openMobile={mobileShowSidebar}
        onOpenMobileChange={setMobileShowSidebar}
        className="relative h-dvh bg-bg-primary text-text-primary [--surface-base:var(--color-surface-app)]"
        style={{ '--sidebar-width': '20rem', '--sidebar-width-mobile': '24rem', '--sidebar-overlay-offset': '4rem' }}
      >
        <ReconnectBanner />
        <AccessNotice />
        <AppNavigationRail className="hidden md:flex" />
        <ConversationSidebar
          onReturnToCall={handleReturnToCall}
          onOpenProfile={setProfileUserId}
          showReturnToCall={!showStage}
          mobileRail={<AppNavigationRail />}
        />
        <FloatingUserDock
          placement="shell"
          onReturnToCall={handleReturnToCall}
          onOpenProfile={setProfileUserId}
          showReturnToCall={!showStage}
        />
        <SidebarInset className="relative min-h-0 overflow-hidden bg-surface-panel [--surface-base:var(--color-surface-panel)] md:m-shell md:rounded-xl md:border md:border-border">
          <Routes location={contentLocation}>
            <Route
              path="/app/conversations/:conversationId?"
              element={showStage ? (
                <Stage allIds={callIds} chatOpen={callChatOpen} onToggleChat={() => setCallChatOpen((v) => !v)} />
              ) : (
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
              )}
            />
            <Route path={ROUTES.friends} element={<FriendsPage onOpenProfile={setProfileUserId} />} />
            <Route path={ROUTES.requests} element={<RequestsRedirect />} />
            <Route path="*" element={<Navigate to={ROUTES.conversations} replace />} />
          </Routes>
          {inCall && <ParticipantAudioLayer participantIds={callIds} />}
          {inCall && !showStage && (
            <FloatingPip
              allIds={callIds}
              onExpand={handleReturnToCall}
            />
          )}
          <ReactionsOverlay />
        </SidebarInset>
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
        <Shell />
      </FriendsProvider>
    </RoomProvider>
  );
}

// The router sits ABOVE the auth gate but only its <Routes> (inside Shell)
// ever swap — RoomProvider, and with it the LiveKit call, never remounts on
// navigation.
function AppProviders() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <AuthGate />
      </TooltipProvider>
    </AuthProvider>
  );
}

// A single splat route whose element owns its own nested <Routes> (in Shell).
// This "descendant routes" setup is the smallest step from a plain router to a
// data router: every route, guard and provider lifecycle stays identical —
// the only reason to make the change at all is that useBlocker (settings'
// unsaved-changes guard) requires a data router to exist somewhere above it.
// It is an in-memory one (see createAppRouter): the URL never changes.
const router = createAppRouter([{ path: '*', element: <AppProviders /> }]);
// client error reports name the route the app is on; the address bar never does
setLogRoute(currentPath);

export function App() {
  return <RouterProvider router={router} />;
}
