import { useEffect, useState } from 'react';
import { fetchAllServerMembers } from '@/features/servers/serversApi';
import { useRoom } from '@/state/RoomContext';
import type { PublicUser } from '@/shared/types/protocol';
import type { SearchScope } from './searchQuery';

/** Who `de:` and `menciona:` offer: the server's members, read the first time
 * they are needed, or the two people of a DM. */
export function useSearchMembers(scope: SearchScope | null, needed: boolean): PublicUser[] {
  const { allUsers, conversations, serverMemberRevision } = useRoom('allUsers', 'conversations', 'serverMemberRevision');
  const serverId = scope && 'serverId' in scope ? scope.serverId : null;
  const key = serverId ? `${serverId}:${serverMemberRevision.get(serverId) ?? 0}` : null;
  const [loaded, setLoaded] = useState<{ key: string; users: PublicUser[] } | null>(null);
  const missing = needed && key !== null && loaded?.key !== key;
  useEffect(() => {
    if (!missing || !serverId || !key) return;
    let cancelled = false;
    fetchAllServerMembers(serverId)
      .then((items) => { if (!cancelled) setLoaded({ key, users: items.map((m) => m.user as PublicUser) }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [missing, serverId, key]);

  if (serverId) return loaded?.key === key ? loaded.users.map((u) => allUsers.get(u.id) ?? u) : [];
  const conversationId = scope && 'conversationId' in scope ? scope.conversationId : null;
  const memberIds = conversations.find((c) => c.id === conversationId)?.memberIds ?? [];
  return memberIds.flatMap((id) => { const user = allUsers.get(id); return user ? [user] : []; });
}
