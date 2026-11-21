import type { ServerSummary } from '@/shared/types/protocol';
import { useOptionalRoomSelector } from '@/state/RoomContext';

/** Where a server emoji or sticker comes from, as the viewer sees it. Which
 * server is told only to its members: GET /api/emojis/meta keeps it from
 * everyone else on purpose. */
export type ExpressionOrigin =
  | { kind: 'here' | 'mine'; server: Pick<ServerSummary, 'id' | 'name' | 'icon'> }
  | { kind: 'elsewhere' }
  | null;

/** `serverId` is the server the account's own list puts it in (undefined
 * when that list doesn't have it); `listReady` says the list was read, so
 * "not in it" means a server the viewer is not in. */
export function useExpressionOrigin(serverId: string | undefined, listReady: boolean): ExpressionOrigin {
  const server = useOptionalRoomSelector((room) => (serverId ? room.servers.find((s) => s.id === serverId) : undefined));
  const openServerId = useOptionalRoomSelector((room) =>
    room.activeConversationId ? room.servers.find((s) => s.channels.some((c) => c.id === room.activeConversationId))?.id : undefined);
  if (server) return { kind: server.id === openServerId ? 'here' : 'mine', server };
  if (!serverId && listReady) return { kind: 'elsewhere' };
  return null;
}

/** The popover's own box: the card fills it edge to edge. */
export const EXPRESSION_POPOVER_CLASS = 'w-[min(18rem,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0';
