import { useCallback, useEffect, useRef, useState } from 'react';
import type { Participant, PublicUser, ServerMessage, VisiblePresence } from '@/shared/types/protocol';

function mergeUserFromParticipant(prev: Map<string, PublicUser>, participant: Participant): Map<string, PublicUser> {
  const existing = prev.get(participant.userId);
  if (!existing || (
    existing.avatar === participant.avatar
    && existing.avatarPoster === participant.avatarPoster
    && existing.avatarColor === participant.avatarColor
    && existing.displayName === participant.displayName
    && existing.banner === participant.banner
    && existing.bio === participant.bio
    && JSON.stringify(existing.profileLinks) === JSON.stringify(participant.profileLinks)
    && existing.role === participant.role
  )) return prev;
  const next = new Map(prev);
  next.set(participant.userId, {
    ...existing, avatar: participant.avatar, avatarPoster: participant.avatarPoster, avatarColor: participant.avatarColor,
    displayName: participant.displayName, banner: participant.banner, bio: participant.bio,
    profileLinks: participant.profileLinks, role: participant.role,
  });
  return next;
}

/** `allUsers` contains friends and conversation members; `participants` contains only connected
 * users. Profiles outside the initial cache are fetched on demand. `setAllUsers` also supports
 * optimistic updates to the current user's profile. */
export function usePresence() {
  const [allUsers, setAllUsers] = useState<Map<string, PublicUser>>(new Map());
  const allUsersRef = useRef<Map<string, PublicUser>>(new Map());
  useEffect(() => { allUsersRef.current = allUsers; }, [allUsers]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  // The friend subset of allUsers — allUsers also carries co-members of a
  // shared conversation who aren't friends (their profile/presence is
  // needed to render that conversation), so anything that should be
  // friends-only (e.g. the friends list) filters
  // against this instead of allUsers directly.
  const [friendUserIds, setFriendUserIds] = useState<Set<string>>(new Set());

  // Status and custom status of online people whose status is not the plain default. A missing
  // entry for someone online means "online"; nothing is kept for anyone offline.
  const [presenceByUser, setPresenceByUser] = useState<Map<string, VisiblePresence>>(new Map());

  const setInitial = useCallback((users: PublicUser[], onlineIds: string[], friendIds: string[], presence?: Record<string, VisiblePresence>) => {
    setAllUsers(new Map(users.map((u) => [u.id, u])));
    setOnlineUserIds(new Set(onlineIds));
    setFriendUserIds(new Set(friendIds));
    setPresenceByUser(new Map(Object.entries(presence ?? {})));
  }, []);

  const onPresenceStatus = useCallback((m: Extract<ServerMessage, { t: 'presence-status' }>) => {
    setPresenceByUser((prev) => {
      const next = new Map(prev);
      if (m.status === 'online' && !m.customStatus) next.delete(m.userId);
      else next.set(m.userId, { status: m.status, customStatus: m.customStatus });
      return next;
    });
  }, []);

  const forgetPresence = useCallback((userId: string) => {
    setPresenceByUser((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const onParticipantJoined = useCallback((m: Extract<ServerMessage, { t: 'participant-joined' }>) => {
    setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
  }, []);
  const onParticipantUpdated = useCallback((m: Extract<ServerMessage, { t: 'participant-updated' }>) => {
    setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
  }, []);
  const onUserOnline = useCallback((m: Extract<ServerMessage, { t: 'user-online' }>) => {
    setOnlineUserIds((prev) => (prev.has(m.userId) ? prev : new Set(prev).add(m.userId)));
  }, []);
  const onUserOffline = useCallback((m: Extract<ServerMessage, { t: 'user-offline' }>) => {
    forgetPresence(m.userId);
    setOnlineUserIds((prev) => {
      if (!prev.has(m.userId)) return prev;
      const next = new Set(prev);
      next.delete(m.userId);
      return next;
    });
    if (!m.lastSeenAt) return;
    setAllUsers((prev) => {
      const existing = prev.get(m.userId);
      if (!existing || existing.lastSeenAt === m.lastSeenAt) return prev;
      const next = new Map(prev);
      next.set(m.userId, { ...existing, lastSeenAt: m.lastSeenAt });
      return next;
    });
  }, [forgetPresence]);
  const onUserDeleted = useCallback((m: Extract<ServerMessage, { t: 'user-deleted' }>) => {
    forgetPresence(m.userId);
    setAllUsers((prev) => {
      if (!prev.has(m.userId)) return prev;
      const next = new Map(prev);
      next.delete(m.userId);
      return next;
    });
    setOnlineUserIds((prev) => {
      if (!prev.has(m.userId)) return prev;
      const next = new Set(prev);
      next.delete(m.userId);
      return next;
    });
  }, [forgetPresence]);

  return {
    allUsers, allUsersRef, setAllUsers, onlineUserIds, friendUserIds, presenceByUser, setInitial,
    onParticipantJoined, onParticipantUpdated, onUserOnline, onUserOffline, onUserDeleted, onPresenceStatus,
  };
}
