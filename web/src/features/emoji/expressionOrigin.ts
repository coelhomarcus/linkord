import { apiFetch } from '@/shared/api/api';
import { createResourceCache, useResource } from '@/shared/lib/resourceCache';
import type { ServerSummary } from '@/shared/types/protocol';
import { useOptionalRoomSelector } from '@/state/RoomContext';

export type SourceServer = Pick<ServerSummary, 'id' | 'name' | 'icon'>;

/** Where a server emoji or sticker comes from, as the viewer sees it. A
 * member's own servers are already in the room; anyone else's is asked for
 * (`server` undefined until it arrives, and for a suspended server). */
export type ExpressionOrigin =
  | { kind: 'here' | 'mine'; server: SourceServer }
  | { kind: 'elsewhere'; server: SourceServer | undefined }
  | null;

export type ExpressionKind = 'emojis' | 'stickers';

function sourceCache(kind: ExpressionKind) {
  return createResourceCache<SourceServer | null>(
    (id, signal) => apiFetch<{ server: SourceServer | null }>(`/api/${kind}/${encodeURIComponent(id)}/source`, { signal }).then((res) => res.server),
    { max: 100 },
  );
}

// shown at once on the next open, and read again behind it (a renamed server)
const sources = { emojis: sourceCache('emojis'), stickers: sourceCache('stickers') };

/** `serverId` is the server the account's own list puts it in (undefined
 * when that list doesn't have it); `listReady` says the list was read, so
 * "not in it" means a server the viewer is not in, which is then read from
 * the server by the expression's id. */
export function useExpressionOrigin(kind: ExpressionKind, id: string, serverId: string | undefined, listReady: boolean): ExpressionOrigin {
  const server = useOptionalRoomSelector((room) => (serverId ? room.servers.find((s) => s.id === serverId) : undefined));
  const openServerId = useOptionalRoomSelector((room) =>
    room.activeConversationId ? room.servers.find((s) => s.channels.some((c) => c.id === room.activeConversationId))?.id : undefined);
  const elsewhere = !serverId && listReady;
  const source = useResource(sources[kind], elsewhere ? id : null);
  if (server) return { kind: server.id === openServerId ? 'here' : 'mine', server };
  if (elsewhere) return { kind: 'elsewhere', server: source.value ?? undefined };
  return null;
}

/** The popover's own box: the card fills it edge to edge. */
export const EXPRESSION_POPOVER_CLASS = 'w-[min(18rem,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0';
