import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { ROUTES, callConversationIdFromPath, conversationIdFromPath, conversationPath, isAwaitingOpen, serverIdFromPath } from '@/shared/lib/routes';
import { rememberChannel } from '@/features/servers/serverUtils';

/** Keeps the current URL and room selection in sync without promoting the
 * automatic first selection into a phone navigation. */
export function useConversationRouteSync(): void {
  const { conversations, activeConversationId, openConversation, state } = useRoom();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedId = conversationIdFromPath(location.pathname) ?? callConversationIdFromPath(location.pathname);
  const knownIds = useMemo(() => new Set(conversations.map((c) => c.id)), [conversations]);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeRef = useRef(activeConversationId);
  const pathRef = useRef(location.pathname);
  const stateRef = useRef(location.state);
  const navigateRef = useRef(navigate);
  const openRef = useRef(openConversation);

  useEffect(() => {
    activeRef.current = activeConversationId;
    pathRef.current = location.pathname;
    stateRef.current = location.state;
    navigateRef.current = navigate;
    openRef.current = openConversation;
  }, [activeConversationId, location.pathname, location.state, navigate, openConversation]);

  useEffect(() => {
    if (!state.joined || requestedId === null) return;
    if (!knownIds.has(requestedId)) {
      // a channel that went away (deleted, or no longer visible) lands on its
      // server; anything else on home
      const serverId = serverIdFromPath(pathRef.current);
      navigateRef.current(serverId ? ROUTES.server(serverId) : ROUTES.home, { replace: true });
      return;
    }
    const conversation = conversationsRef.current.find((c) => c.id === requestedId);
    if (conversation?.serverId && conversation.type === 'text') rememberChannel(conversation.serverId, conversation.id);
    // a voice channel's chat opens with its call, not by visiting it
    if (conversation?.type === 'voice') return;
    if (requestedId !== activeRef.current) openRef.current(requestedId);
  }, [state.joined, requestedId, knownIds]);

  const skippedInitialRef = useRef(false);
  useEffect(() => {
    if (!state.joined || !activeConversationId) return;
    if (!skippedInitialRef.current) {
      skippedInitialRef.current = true;
      return;
    }
    const current = pathRef.current;
    if (conversationIdFromPath(current) === activeConversationId || callConversationIdFromPath(current) === activeConversationId) return;
    // a DM just opened may not be listed yet: DMs are the only ones that can
    // be unknown here
    const conversation = conversationsRef.current.find((c) => c.id === activeConversationId);
    navigateRef.current(conversation ? conversationPath(conversation) : ROUTES.direct(activeConversationId), { replace: isAwaitingOpen(stateRef.current) });
  }, [state.joined, activeConversationId]);
}
