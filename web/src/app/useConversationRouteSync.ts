import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { ROUTES, conversationIdFromPath, conversationIdFromState, conversationNav, homeFor, isAwaitingOpen, isBotsPath } from '@/shared/lib/routes';

/** Keeps the conversation named by the router entry and the room's
 * `activeConversationId` in agreement without either one being "the" source of
 * truth — the active conversation is opened from many places (sidebar,
 * notifications, a group just created) that know nothing about history.
 *
 * The id lives in the entry's `state`, never in the path (which stays
 * `/app/conversations`); a legacy `/app/conversations/:id` link is rewritten
 * to that shape. Each direction reacts ONLY to its own source changing, and
 * each one is a no-op when both already agree — that is what prevents the two
 * from fighting:
 *   entry → state : the entry's id changed (a legacy path, navigating back)
 *   state → entry : the active conversation changed
 *   bare entry    : /app/conversations with an active conversation gets its id
 *
 * Bots work the same way on /app/bots: a conversation always opens on its own
 * page (`homeFor`), and each page only ever claims the conversations it shows. */
export function useConversationRouteSync(): void {
  const { conversations, activeConversationId, openConversation, state } = useRoom();
  const location = useLocation();
  const navigate = useNavigate();
  const joined = state.joined;
  const legacyPathId = conversationIdFromPath(location.pathname);
  const stateId = conversationIdFromState(location.state);
  const onBots = isBotsPath(location.pathname);
  const isBare = onBots || location.pathname === ROUTES.conversations || location.pathname === `${ROUTES.conversations}/`;
  const page = onBots ? ROUTES.bots : ROUTES.conversations;
  const requestedId = legacyPathId ?? (isBare ? stateId : null);
  const awaitingOpen = isAwaitingOpen(location.state);

  const homeById = useMemo(() => new Map(conversations.map((c) => [c.id, homeFor(c)])), [conversations]);
  // an id this page doesn't show (a bot named on /app/conversations) counts as unknown
  const requestedIdKnown = requestedId !== null && homeById.get(requestedId) === page;
  const activeHome = activeConversationId ? homeById.get(activeConversationId) ?? null : null;
  const homeByIdRef = useRef(homeById);

  // Read inside the effects below instead of listed as dependencies: each
  // effect must re-run ONLY when its own source changes, or it turns into an
  // echo of the other side. `navigate` is the sharp one — with BrowserRouter
  // its identity changes on every route change, so listing it made the
  // state→entry effect re-run after going to /app/friends and drag the user
  // straight back to the active conversation. Declared first so they are
  // already fresh when those effects run in the same commit.
  const activeRef = useRef(activeConversationId);
  const pathRef = useRef(location.pathname);
  const stateIdRef = useRef(stateId);
  const navigateRef = useRef(navigate);
  const openRef = useRef(openConversation);
  useEffect(() => {
    activeRef.current = activeConversationId;
    pathRef.current = location.pathname;
    stateIdRef.current = stateId;
    navigateRef.current = navigate;
    openRef.current = openConversation;
    homeByIdRef.current = homeById;
  }, [activeConversationId, location.pathname, stateId, navigate, openConversation, homeById]);

  useEffect(() => {
    if (!joined || requestedId === null) return;
    if (!requestedIdKnown) {
      navigateRef.current(page, { replace: true });
      return;
    }
    if (requestedId !== activeRef.current) openRef.current(requestedId);
    if (legacyPathId !== null) navigateRef.current(ROUTES.conversations, { replace: true, ...conversationNav(legacyPathId) });
  }, [joined, requestedId, requestedIdKnown, legacyPathId, page]);

  // The first active conversation is the one auto-selected right after
  // connecting — not a navigation the user asked for, so it must not drag a
  // deep link to /app/friends over to a conversation.
  const skippedAutoSelectRef = useRef(false);
  useEffect(() => {
    if (!joined || !activeConversationId) return;
    if (!skippedAutoSelectRef.current) {
      skippedAutoSelectRef.current = true;
      return;
    }
    const home = homeByIdRef.current.get(activeConversationId) ?? ROUTES.conversations;
    const current = pathRef.current;
    const onBare = current === home || current === `${home}/`;
    if (onBare && stateIdRef.current === activeConversationId) return;
    // sitting on the bare entry (no conversation named yet) means this open IS
    // the one it was waiting for — replace it instead of stacking a second entry
    navigateRef.current(home, { replace: onBare && stateIdRef.current === null, ...conversationNav(activeConversationId) });
  }, [joined, activeConversationId]);

  // what each page had open last, so switching between Conversas and Bots
  // comes back to it instead of an empty panel
  const lastByPageRef = useRef(new Map<string, string>());
  useEffect(() => {
    if (activeConversationId && activeHome) lastByPageRef.current.set(activeHome, activeConversationId);
  }, [activeConversationId, activeHome]);

  useEffect(() => {
    if (!joined || !isBare || stateId !== null || awaitingOpen) return;
    if (activeConversationId && activeHome === page) {
      navigateRef.current(page, { replace: true, ...conversationNav(activeConversationId) });
      return;
    }
    const last = lastByPageRef.current.get(page);
    // never a bot unasked: opening one marks it read
    const fallback = page === ROUTES.conversations ? conversations.find((c) => c.type !== 'bot')?.id : undefined;
    const target = last && homeById.get(last) === page ? last : fallback;
    if (target) openRef.current(target);
  }, [joined, isBare, stateId, awaitingOpen, activeConversationId, activeHome, page, conversations, homeById]);
}
