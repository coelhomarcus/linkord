import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema.js';
import { participants, send } from '../presence/participants.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { channelPermissionsIn, loadServerSnapshot } from '../servers/serverAccess.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// A still of someone's screen share, for whoever hovers its "ao vivo" badge
// without being in the call. The server cannot see the stream (the media only
// flows through LiveKit), so the streamer's own client draws a frame and
// sends it. The frame lives here in memory for a few seconds, so a burst of
// hovers costs the streamer one capture, and is never written anywhere.

/** Long enough to absorb a burst of hovers, short enough to still be "now". */
const PREVIEW_TTL_MS = 10_000;
/** A streamer whose client never answers (backgrounded tab, old build) must
 * not leave the hover spinning. */
const CAPTURE_TIMEOUT_MS = 5_000;
/** Under the socket's 64KB message cap with room to spare; the client
 * downscales and recompresses to fit. */
export const MAX_PREVIEW_CHARS = 60_000;

const PREVIEW_PATTERN = /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function isValidPreviewImage(image: unknown): image is string {
  return typeof image === 'string' && image.length <= MAX_PREVIEW_CHARS && PREVIEW_PATTERN.test(image);
}

type Waiter = (image: string | null) => void;

/** What happened to a request: answered from memory, a capture to ask the
 * streamer for, or joined to one already asked for. */
export type PreviewRequestOutcome = 'cached' | 'capture' | 'waiting';

export function createPreviewBroker({ ttlMs, timeoutMs, now = Date.now }: { ttlMs: number; timeoutMs: number; now?: () => number }) {
  const frames = new Map<string, { image: string; at: number }>();
  const pending = new Map<string, { waiters: Waiter[]; timer: ReturnType<typeof setTimeout> }>();

  function settle(streamerId: string, image: string | null): void {
    const entry = pending.get(streamerId);
    if (!entry) return;
    pending.delete(streamerId);
    clearTimeout(entry.timer);
    for (const waiter of entry.waiters) waiter(image);
  }

  function sweep(): void {
    const cutoff = now() - ttlMs;
    for (const [id, frame] of frames) if (frame.at <= cutoff) frames.delete(id);
  }

  return {
    request(streamerId: string, waiter: Waiter): PreviewRequestOutcome {
      const frame = frames.get(streamerId);
      if (frame && now() - frame.at < ttlMs) {
        waiter(frame.image);
        return 'cached';
      }
      const entry = pending.get(streamerId);
      if (entry) {
        entry.waiters.push(waiter);
        return 'waiting';
      }
      const timer = setTimeout(() => settle(streamerId, null), timeoutMs);
      timer.unref?.();
      pending.set(streamerId, { waiters: [waiter], timer });
      return 'capture';
    },
    /** A frame from the streamer; ignored unless someone asked for one, so a
     * client cannot push images nobody requested. */
    deliver(streamerId: string, image: string): boolean {
      if (!pending.has(streamerId)) return false;
      sweep();
      frames.set(streamerId, { image, at: now() });
      settle(streamerId, image);
      return true;
    },
  };
}

const broker = createPreviewBroker({ ttlMs: PREVIEW_TTL_MS, timeoutMs: CAPTURE_TIMEOUT_MS });

/** The permissions a still asks for: those of joining the call, since the
 * still is a frame of what joining would show. Seeing the channel alone
 * (a locked voice channel listed to everyone) is not enough. */
export const STREAM_PREVIEW_PERMISSIONS = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT;

/** Who may see the still: anyone who could join the voice channel it is
 * streamed in. A DM call has no channel list, so it never offers one. */
async function canSeeStream(viewerUserId: string, callConversationId: string): Promise<boolean> {
  const [call] = await db.select({ serverId: conversations.serverId }).from(conversations).where(eq(conversations.id, callConversationId)).limit(1);
  if (!call?.serverId) return false;
  const snapshot = await loadServerSnapshot(call.serverId);
  return !!snapshot && hasPermission(channelPermissionsIn(snapshot, callConversationId, viewerUserId), STREAM_PREVIEW_PERMISSIONS);
}

async function handlePreviewRequest(socket: AppSocket, msg: { participantId?: string }): Promise<void> {
  const viewer = participants.get(socket.participantId ?? '');
  if (!viewer || viewer.socket !== socket) return;
  const participantId = String(msg.participantId || '');
  if (!participantId) return;
  const answer = (image: string | null) => send(socket, { t: 'stream-preview', participantId, image });

  const streamer = participants.get(participantId);
  const callId = streamer?.callConversationId;
  if (!streamer || !streamer.sharing || !callId || streamer.id === viewer.id || viewer.blockedPeerIds.has(streamer.userId)) {
    answer(null);
    return;
  }
  if (!(await canSeeStream(viewer.userId, callId))) {
    answer(null);
    return;
  }
  if (broker.request(streamer.id, answer) === 'capture') send(streamer.socket, { t: 'stream-preview-capture' });
}

function handlePreviewFrame(socket: AppSocket, msg: { image?: unknown }): void {
  const streamer = participants.get(socket.participantId ?? '');
  if (!streamer || streamer.socket !== socket || !streamer.sharing) return;
  if (!isValidPreviewImage(msg.image)) return;
  broker.deliver(streamer.id, msg.image);
}

export const handlers: HandlerTable = {
  'stream-preview-request': handlePreviewRequest,
  'stream-preview-frame': handlePreviewFrame,
};
