import { useCallback, useMemo, useRef, useState } from 'react';
import type { Conversation, ServerMessage, ServerSummary } from '@/shared/types/protocol';

/** The rail's order: the member's own, oldest join breaking a tie. */
function sortServers(list: ServerSummary[]): ServerSummary[] {
  return [...list].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

/** A channel seen as a conversation — what chat, calls and unread work with. */
export function channelConversation(server: ServerSummary, channel: ServerSummary['channels'][number]): Conversation {
  return {
    id: channel.id, type: channel.type, title: channel.name, memberIds: [], serverId: server.id,
    lastMessageAt: null, createdAt: server.createdAt, updatedAt: server.createdAt, pinnedAt: null,
    topic: channel.topic, categoryId: channel.categoryId, position: channel.position, permissions: channel.permissions,
  };
}

/** The servers this account is in, as the server last described each one to
 * it. Every change arrives as a fresh whole summary (server-updated), so this
 * only ever replaces by id. Member lists are fetched over HTTP; the
 * `memberRevision` bump is what tells an open list to refetch. */
export function useServersList() {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const serversRef = useRef<ServerSummary[]>([]);
  const [memberRevision, setMemberRevision] = useState<Map<string, number>>(new Map());
  const [memberRoleIds, setMemberRoleIds] = useState<Map<string, Map<string, string[]>>>(new Map());

  const commit = useCallback((next: ServerSummary[]) => {
    const sorted = sortServers(next);
    serversRef.current = sorted;
    setServers(sorted);
  }, []);

  const setInitial = useCallback((initial: ServerSummary[]) => commit(initial), [commit]);

  const upsert = useCallback((server: ServerSummary) => {
    const known = serversRef.current.some((s) => s.id === server.id);
    commit(known ? serversRef.current.map((s) => (s.id === server.id ? server : s)) : [...serversRef.current, server]);
  }, [commit]);

  const onServerChanged = useCallback((m: Extract<ServerMessage, { t: 'server-created' | 'server-updated' }>) => upsert(m.server), [upsert]);

  /** Returns what was removed, so the caller can name it in a notice. */
  const onServerDeleted = useCallback((m: Extract<ServerMessage, { t: 'server-deleted' }>): ServerSummary | null => {
    const gone = serversRef.current.find((s) => s.id === m.serverId) ?? null;
    commit(serversRef.current.filter((s) => s.id !== m.serverId));
    setMemberRoleIds((prev) => {
      if (!prev.has(m.serverId)) return prev;
      const next = new Map(prev);
      next.delete(m.serverId);
      return next;
    });
    return gone;
  }, [commit]);

  const onMembersChanged = useCallback((m: Extract<ServerMessage, { t: 'server-member-added' | 'server-member-removed' | 'server-member-updated' }>) => {
    setMemberRevision((prev) => new Map(prev).set(m.serverId, (prev.get(m.serverId) ?? 0) + 1));
    if (m.t === 'server-member-updated' || m.t === 'server-member-removed') {
      setMemberRoleIds((prev) => {
        const current = prev.get(m.serverId);
        if (!current) return prev;
        const next = new Map(current);
        if (m.t === 'server-member-removed') next.delete(m.userId);
        else next.set(m.userId, m.roleIds);
        return new Map(prev).set(m.serverId, next);
      });
    }
  }, []);

  const setMemberSnapshot = useCallback((serverId: string, members: { userId: string; roleIds: string[] }[]) => {
    setMemberRoleIds((prev) => new Map(prev).set(serverId, new Map(members.map((member) => [member.userId, member.roleIds]))));
  }, []);

  /** Optimistic: the rail moves at once, the server keeps the order. */
  const reorderLocally = useCallback((serverIds: string[]) => {
    const byId = new Map(serversRef.current.map((s) => [s.id, s]));
    commit(serverIds.flatMap((id, position) => {
      const server = byId.get(id);
      return server ? [{ ...server, position }] : [];
    }));
  }, [commit]);

  const channelConversations = useMemo(
    () => servers.flatMap((server) => server.channels.map((channel) => channelConversation(server, channel))),
    [servers],
  );

  return { servers, serversRef, memberRevision, memberRoleIds, setMemberSnapshot, channelConversations, setInitial, onServerChanged, onServerDeleted, onMembersChanged, reorderLocally };
}
