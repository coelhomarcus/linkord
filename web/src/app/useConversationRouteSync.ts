import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { ROUTES, callConversationIdFromPath, conversationIdFromPath, isAwaitingOpen } from '@/shared/lib/routes';

/** Keeps the current URL and room selection in sync without promoting the
 * automatic first selection into a phone navigation. */
export function useConversationRouteSync(): void {
  const { conversations, activeConversationId, openConversation, state } = useRoom();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedId = conversationIdFromPath(location.pathname) ?? callConversationIdFromPath(location.pathname);
  const knownIds = useMemo(() => new Set(conversations.map((c) => c.id)), [conversations]);
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
      navigateRef.current(ROUTES.conversations, { replace: true });
      return;
    }
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
    navigateRef.current(ROUTES.conversation(activeConversationId), { replace: isAwaitingOpen(stateRef.current) });
  }, [state.joined, activeConversationId]);
}
