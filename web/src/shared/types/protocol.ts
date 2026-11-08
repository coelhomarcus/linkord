import type { LinkPreviewData } from '@/shared/api/api';

export interface Participant {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
  deafened: boolean;
  callConversationId: string | null;
  micActivated: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
}

export type ReactionEmoji = string;

/** Wire protocol version this build speaks; the server refuses older ones
 * (client_outdated). Keep in sync with server/src/realtime/protocolVersion.ts
 * — version 9 drops pinned conversations. */
export const PROTOCOL_VERSION = 9;

export interface ChatReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
  attachmentCount?: number;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

/** The live state of a server invitation, as embedded in a `server_invite`
 * message. `expired` only appears on invitations that lapsed before they
 * stopped expiring. */
export interface InvitationCard {
  id: string;
  status: InvitationStatus;
  serverId: string;
  serverName: string;
  serverIcon: string;
  memberCount: number;
  inviterId: string;
  inviteeId: string;
  version: number;
}

/** The voice channel a `call_invite` message points at. Who is in that call
 * is not part of it: the card reads that live from presence. */
export interface CallInviteCard {
  channelId: string;
  channelName: string;
  serverId: string;
  serverName: string;
  serverIcon: string;
}

export interface ChatMessage {
  msgId: number;
  conversationId: string;
  id: string | null;
  name: string;
  avatar: string;
  text: string;
  ts: number;
  replyTo?: ChatReplyRef;
  editedAt?: number;
  reactions?: Partial<Record<ReactionEmoji, string[]>>;
  attachments?: ChatAttachment[];
  kind?: 'text' | 'server_invite' | 'call_invite' | 'dm_call';
  /** Whole seconds of talk time on a dm_call. Null when nobody answered. */
  callDurationSeconds?: number | null;
  // `null` on a group_invite message = the group is gone (tombstone)
  invitation?: InvitationCard | null;
  // the group whose call a call_invite asks to join; `null` once it's gone
  callInvite?: CallInviteCard | null;
  // the author's send key, present when the send was correlated — lets the
  // author's client swap its pending copy for this one without remounting
  clientMessageId?: string;
  // previews of the message's link cards, stored by the server so a card is
  // drawn at its final size at once; missing ones are fetched as before
  embeds?: LinkPreviewData[];
  // links whose card the author removed: they stay plain links
  suppressedEmbeds?: string[];
  // posted by the conversation's bot: `id` is null, name/avatar are the bot's
  bot?: true;
  // structured cards the bot sent with the message
  richEmbeds?: RichEmbed[];
}

interface RichEmbedField { name: string; value: string; inline: boolean }

/** A bot's card, as the server normalized it (see server/src/modules/bots/richEmbeds.ts). */
export interface RichEmbed {
  title?: string;
  description?: string;
  url?: string;
  // 0xRRGGBB
  color?: number;
  fields?: RichEmbedField[];
  footer?: string;
  // ISO 8601
  timestamp?: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  // Present for image attachments with a generated preview — smaller,
  // resized copy for thumbnails. The ORIGINAL (`id`) is still what full-size
  // views (lightbox, download) use.
  thumbId?: string;
  // Displayed size of an image, when the server could read it — lets the
  // row reserve the final box before the pixels arrive.
  width?: number;
  height?: number;
  // base64 ThumbHash: a blurred stand-in to paint while the image loads
  placeholder?: string;
}
// the server's default per-file limit; `welcome.maxAttachmentBytes` says what this server really takes
export const DEFAULT_MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_AVATAR_BYTES = 12 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_BANNER_LEN = 500;
export const MAX_PROFILE_BIO_LEN = 300;

export interface SearchResult {
  msgId: number;
  conversationId: string;
  conversationName: string;
  id: string | null;
  name: string;
  avatar: string;
  ts: number;
  snippet: string;
}

/** A DM, or a server channel seen as a place to chat. The server sends a DM
 * summary as is; a channel is built on the client from its server's summary
 * (features/servers/useServersList.ts), so chat, calls and unread never need
 * to know which kind they are looking at. */
export interface Conversation {
  id: string;
  type: 'direct' | 'text' | 'voice';
  /** a channel's name; '' on a DM */
  title: string;
  /** a DM's two members; empty on a channel (its server knows who is in it) */
  memberIds: string[];
  serverId: string | null;
  lastMessageAt: number | null;
  createdAt: number;
  updatedAt: number;
  topic?: string;
  categoryId?: string | null;
  position?: number;
  /** effective permission bits in a channel (features/servers/permissionBits.ts); absent on a DM */
  permissions?: number;
}

/** A DM as the server sends it — no title or server. */
export type DirectSummary = Omit<Conversation, 'title' | 'serverId'> & Partial<Pick<Conversation, 'title' | 'serverId'>>;

export interface RoleSummary {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: number;
  hoist: boolean;
  mentionable: boolean;
  isDefault: boolean;
}

export interface CategorySummary { id: string; name: string; position: number }

export interface ChannelSummary {
  id: string;
  serverId: string;
  type: 'text' | 'voice';
  name: string;
  topic: string;
  categoryId: string | null;
  position: number;
  permissionsSynced: boolean;
  permissions: number;
}

/** A server as THIS member sees it: hidden channels are absent and
 * `permissions` are already resolved for them. */
export interface ServerSummary {
  id: string;
  name: string;
  icon: string;
  ownerId: string | null;
  status: 'active' | 'suspended';
  createdAt: number;
  memberCount: number;
  /** the member's own order of this server in their rail */
  position: number;
  permissions: number;
  myRoleIds: string[];
  roles: RoleSummary[];
  categories: CategorySummary[];
  channels: ChannelSummary[];
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  /** the first frame of an animated avatar ('' for a still one) */
  avatarPoster?: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
  lastSeenAt?: string | null;
}

/** Only the fields present are changed — everything else keeps its last
 * confirmed value on the server. A media-only patch (after an avatar/banner
 * upload) omits the text fields entirely, so it can never publish a draft
 * that hasn't been saved. `requestId` correlates the `profile-result`. */
export type ProfilePatch = Partial<{
  avatar: string; avatarPoster: string; avatarColor: string; displayName: string;
  banner: string; bannerPoster: string; bio: string;
}>;

export type ClientMessage =
  | { t: 'join'; id?: string; token?: string; v: number }
  | ({ t: 'profile'; requestId: string } & ProfilePatch)
  | { t: 'deafened'; value: boolean }
  | { t: 'mic-state'; activated: boolean; muted: boolean }
  | { t: 'camera'; on: boolean }
  | { t: 'screen-share'; on: boolean }
  | { t: 'speaking'; value: boolean }
  | { t: 'conversation-open'; conversationId: string }
  | { t: 'conversation-mark-read'; conversationId: string; msgId: number }
  | { t: 'direct-open'; userId: string }
  | { t: 'conversation-close'; conversationId: string }
  | { t: 'load-more-messages'; conversationId: string; beforeMsgId: number; requestId?: string }
  | { t: 'load-messages-after'; conversationId: string; afterMsgId: number; requestId?: string }
  | { t: 'load-messages-around'; conversationId: string; msgId: number; requestId?: string }
  | { t: 'message-search'; query: string; conversationId?: string }
  | { t: 'chat'; conversationId: string; text: string; replyTo?: number; requestId?: string; clientMessageId?: string; attachmentIds?: string[] }
  | { t: 'chat-delete'; msgId: number; requestId?: string }
  | { t: 'chat-edit'; msgId: number; text: string; requestId?: string }
  | { t: 'chat-remove-attachment'; msgId: number; attachmentId: string; requestId?: string }
  | { t: 'chat-suppress-embed'; msgId: number; url: string; requestId?: string }
  | { t: 'chat-react'; msgId: number; emoji: ReactionEmoji; present?: boolean; requestId?: string }
  | { t: 'typing'; conversationId: string; value: boolean }
  | { t: 'call-join'; conversationId: string }
  | { t: 'call-leave' }
  | { t: 'dm-call-start'; conversationId: string; video?: boolean }
  | { t: 'dm-call-accept'; callId: string }
  | { t: 'dm-call-decline'; callId: string }
  | { t: 'dm-call-cancel'; callId: string }
  | { t: 'call-kick'; participantId: string }
  | { t: 'call-move'; participantId: string; conversationId: string }
  | { t: 'stream-preview-request'; participantId: string }
  // answers a `stream-preview-capture`: a JPEG data URL of the shared screen
  | { t: 'stream-preview-frame'; image: string }
  | { t: 'soundboard-play'; conversationId: string; soundId: string }
  | { t: 'leave' }
  | { t: 'ping' };

export type DmCallEndReason = 'declined' | 'cancelled' | 'missed' | 'ended' | 'failed';

/** What one account sees of a private call. `media` is true only for the tab that should connect. */
export interface DmCallView {
  callId: string;
  conversationId: string;
  video: boolean;
  phase: 'outgoing' | 'incoming' | 'active';
  callerId: string;
  peerId: string;
  startedAt: number;
  media: boolean;
}

export type ServerMessage =
  | { t: 'profile-connections-changed'; userId: string; profileLinks: string[] }
  | {
      t: 'welcome'; id: string; token: string;
      userId: string; name: string; displayName: string; avatar: string; avatarPoster: string; avatarColor: string;
      banner: string; bannerPoster: string; bio: string; profileLinks: string[]; role: 'user' | 'admin';
      maxParticipants: number; participants: Participant[];
      conversations: DirectSummary[]; servers: ServerSummary[]; knownUsers: PublicUser[]; onlineUserIds: string[]; friendIds: string[];
      // conversation id → unread count (capped at 100); absent from servers before persisted unread
      unreadByConversation?: Record<string, number>;
      // the largest file this server takes; absent from servers before protocol 8
      maxAttachmentBytes?: number;
      livekitUrl: string;
      // the call this connection is in server-side; absent from servers that predate it
      callConversationId?: string | null;
      // absent from servers before protocol 3 (no correlated chat sends)
      protocolVersion?: number;
      dmCall?: DmCallView;
    }
  | { t: 'call-token'; conversationId: string; livekitUrl: string; livekitToken: string }
  | ({ t: 'dm-call' } & DmCallView)
  | { t: 'dm-call-ended'; callId: string; conversationId: string; reason: DmCallEndReason }
  // a moderator moved this connection: it already left its call, join this one
  | { t: 'call-moved'; conversationId: string }
  // someone hovered this connection's "ao vivo" badge: send a frame of the share
  | { t: 'stream-preview-capture' }
  // null when there is no still to show (not sharing anymore, no answer, no access)
  | { t: 'stream-preview'; participantId: string; image: string | null }
  | { t: 'conversation-opened'; conversationId: string; conversation: DirectSummary }
  | { t: 'conversation-created'; conversation: DirectSummary }
  | { t: 'conversation-updated'; conversation: DirectSummary }
  | { t: 'server-created'; server: ServerSummary }
  | { t: 'server-updated'; server: ServerSummary }
  | { t: 'server-deleted'; serverId: string; reason?: 'removed' | 'banned' | 'deleted' }
  | { t: 'server-member-added'; serverId: string; userId: string }
  | { t: 'server-member-removed'; serverId: string; userId: string }
  | { t: 'server-member-updated'; serverId: string; userId: string; roleIds: string[] }
  | { t: 'conversation-read'; conversationId: string; lastReadMessageId: number }
  | { t: 'conversation-history'; conversationId: string; messages: ChatMessage[]; hasMore: boolean; firstUnreadMessageId?: number | null }
  | { t: 'conversation-history-more'; conversationId: string; messages: ChatMessage[]; hasMore: boolean; requestId?: string }
  | { t: 'conversation-history-newer'; conversationId: string; messages: ChatMessage[]; hasMoreAfter: boolean; requestId?: string }
  | { t: 'conversation-history-around'; conversationId: string; msgId: number; messages: ChatMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean }
  | { t: 'conversation-deleted'; conversationId: string }
  | { t: 'participant-joined'; participant: Participant }
  | { t: 'participant-updated'; participant: Participant }
  | { t: 'participant-left'; id: string }
  | { t: 'soundboard-play'; conversationId: string; serverId: string; soundId: string; participantId: string; emoji: string; volume: number }
  // payload-free like social-changed: the list itself comes from GET /api/servers/:id/sounds
  | { t: 'server-sounds-changed'; serverId: string }
  | { t: 'message-search-results'; query: string; conversationId?: string; results: SearchResult[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-send-result'; requestId: string; clientMessageId: string; message?: ChatMessage; error?: { code: string; message: string } }
  | { t: 'chat-deleted'; conversationId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'chat-embeds'; conversationId: string; msgId: number; embeds: LinkPreviewData[] }
  | { t: 'chat-action-result'; requestId: string; error?: { code: string; message: string } }
  | { t: 'invitation-updated'; invitation: InvitationCard }
  | { t: 'role-updated'; role: 'user' | 'admin' }
  | { t: 'chat-reaction-updated'; conversationId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  | { t: 'typing'; conversationId: string; userId: string; value: boolean }
  | { t: 'chat-attachment-added'; conversationId: string; msgId: number; attachment: ChatAttachment }
  // payload-free: "your friends/requests/blocks changed, refetch" — the data
  // itself only ever travels over the authorized HTTP endpoints
  | { t: 'social-changed' }
  // the scoped snapshot re-sent when this connection's known peers change
  // (same shape the welcome carries)
  | { t: 'presence-sync'; knownUsers: PublicUser[]; participants: Participant[]; onlineUserIds: string[]; friendIds: string[] }
  | { t: 'user-online'; userId: string }
  | { t: 'user-offline'; userId: string; lastSeenAt?: string | null }
  | { t: 'user-deleted'; userId: string }
  // answers the `profile` patch of the same requestId, once the server has
  // actually persisted it (or refused to) — never inferred from
  // `participant-updated`, which a different account's edit also triggers
  | ({ t: 'profile-result'; requestId: string; ok: true; profileLinks: string[] } & ProfilePatch)
  | { t: 'profile-result'; requestId: string; ok: false; code: string; message: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }
  | { t: 'server-restart' };
