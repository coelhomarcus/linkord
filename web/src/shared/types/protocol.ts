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
  /** Joined a call and the mic is not settled yet (protocol 18; absent from an older server). */
  micStarting?: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
}

export type ReactionEmoji = string;

/** Wire protocol version this build speaks; the server refuses older ones
 * (client_outdated). Keep in sync with server/src/realtime/protocolVersion.ts
 * — version 21 makes link previews richer (optional `type`, `images`, `player`… on `embeds`). */
export const PROTOCOL_VERSION = 21;

/** One server's or one channel/DM's notification setting (protocol 19). `level` null inherits: a channel
 * from its server, a server or a DM from "all". `mutedUntil` (ISO) is only read while `muted`, and null
 * there means until turned off. */
export interface NotificationSetting {
  level: 'all' | 'mentions' | 'nothing' | null;
  muted: boolean;
  mutedUntil: string | null;
}

export interface NotificationSettings {
  servers: Record<string, NotificationSetting>;
  conversations: Record<string, NotificationSetting>;
}

/** Mirrors server/src/modules/presence/userStatus.ts. */
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';
/** What other people can see: invisible reads as offline and is never sent. */
type VisibleStatus = Exclude<PresenceStatus, 'invisible'>;

export interface CustomStatus {
  emoji: string;
  text: string;
  /** ISO time it stops showing, null for never */
  expiresAt: string | null;
}

/** Someone else's status while they appear online. */
export interface VisiblePresence {
  status: VisibleStatus;
  customStatus: CustomStatus | null;
}

/** The account's own status: `status` is what was picked, `effective` adds automatic idle. */
export interface OwnStatus {
  status: PresenceStatus;
  effective: PresenceStatus;
  customStatus: CustomStatus | null;
}

export interface ChatReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
  attachmentCount?: number;
  /** The original is a sticker: its name, or '' when it was deleted since. */
  sticker?: string;
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
  // the message is this server sticker (its text is empty); `null` once the
  // sticker was deleted
  sticker?: StickerCard | null;
  // what its @everyone/@here and role mentions notified, decided by the
  // server with the author's permission (absent: nobody, or an older server)
  mentionEveryone?: true;
  mentionRoleIds?: string[];
}

/** What a message carries about its sticker. Which server it is from is
 * known only to that server's members (features/stickers/myStickers.ts). */
export interface StickerCard {
  id: string;
  name: string;
  description: string;
  animated: boolean;
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
  // Only on an audio file recorded as a voice message (since protocol 11).
  voice?: VoiceMeta;
}

export interface VoiceMeta {
  /** from the recorder; the file itself often has no duration */
  durationMs: number;
  /** base64, one byte (0-255) per bar */
  waveform: string;
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
  // either field may be left out; customStatus null clears it
  | { t: 'presence-set'; requestId?: string; status?: PresenceStatus; customStatus?: CustomStatus | null }
  // this tab stopped (or started again) being used; feeds automatic idle
  | { t: 'presence-activity'; idle: boolean }
  | { t: 'deafened'; value: boolean }
  | { t: 'mic-state'; activated: boolean; muted: boolean; starting?: boolean }
  | { t: 'camera'; on: boolean }
  | { t: 'screen-share'; on: boolean }
  | { t: 'speaking'; value: boolean }
  | { t: 'conversation-open'; conversationId: string }
  | { t: 'conversation-mark-read'; conversationId: string; msgId: number }
  | { t: 'conversation-mark-all-read'; conversationId: string }
  | { t: 'server-mark-all-read'; serverId: string }
  | { t: 'direct-open'; userId: string }
  | { t: 'conversation-close'; conversationId: string }
  | { t: 'load-more-messages'; conversationId: string; beforeMsgId: number; requestId?: string }
  | { t: 'load-messages-after'; conversationId: string; afterMsgId: number; requestId?: string }
  | { t: 'load-messages-around'; conversationId: string; msgId: number; requestId?: string }
  | { t: 'message-search'; query: string; conversationId?: string }
  | { t: 'chat'; conversationId: string; text: string; replyTo?: number; requestId?: string; clientMessageId?: string; attachmentIds?: string[]; stickerId?: string }
  | { t: 'chat-delete'; msgId: number; requestId?: string }
  | { t: 'chat-edit'; msgId: number; text: string; requestId?: string }
  | { t: 'chat-remove-attachment'; msgId: number; attachmentId: string; requestId?: string }
  | { t: 'chat-suppress-embed'; msgId: number; url: string; requestId?: string }
  | { t: 'chat-react'; msgId: number; emoji: ReactionEmoji; present?: boolean; requestId?: string }
  | { t: 'typing'; conversationId: string; value: boolean }
  // `replace`: the person agreed to move the call the account holds on another connection to this one
  | { t: 'call-join'; conversationId: string; replace?: boolean }
  | { t: 'call-leave' }
  | { t: 'dm-call-start'; conversationId: string; video?: boolean; replace?: boolean }
  | { t: 'dm-call-accept'; callId: string; replace?: boolean }
  | { t: 'dm-call-decline'; callId: string }
  | { t: 'dm-call-cancel'; callId: string }
  | { t: 'call-kick'; participantId: string }
  | { t: 'call-move'; participantId: string; conversationId: string }
  | { t: 'stream-preview-request'; participantId: string }
  // answers a `stream-preview-capture`: a JPEG data URL of the shared screen
  | { t: 'stream-preview-frame'; image: string }
  | { t: 'soundboard-play'; conversationId: string; serverId?: string; soundId: string }
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
      // both absent from servers before protocol 19: nothing muted, and no mention counts of their own
      notificationSettings?: NotificationSettings;
      mentionsByConversation?: Record<string, number>;
      // the largest file this server takes; absent from servers before protocol 8
      maxAttachmentBytes?: number;
      livekitUrl: string;
      // the call this connection is in server-side; absent from servers that predate it
      callConversationId?: string | null;
      // absent from servers before protocol 3 (no correlated chat sends)
      protocolVersion?: number;
      // both absent from servers before protocol 10: everyone online reads as plain "online"
      presence?: Record<string, VisiblePresence>;
      myStatus?: OwnStatus;
      dmCall?: DmCallView;
    }
  | { t: 'call-token'; conversationId: string; livekitUrl: string; livekitToken: string }
  | ({ t: 'dm-call' } & DmCallView)
  | { t: 'dm-call-ended'; callId: string; conversationId: string; reason: DmCallEndReason }
  // a moderator moved this connection: it already left its call, join this one
  | { t: 'call-moved'; conversationId: string }
  // another connection of this account entered a call: this one is already out of this call
  | { t: 'call-replaced'; conversationId: string }
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
  | { t: 'soundboard-play'; conversationId: string; serverId: string; soundId: string; participantId: string; emoji: string; volume: number; fileToken?: string }
  // payload-free like social-changed: the list itself comes from GET /api/servers/:id/sounds
  | { t: 'server-sounds-changed'; serverId: string }
  | { t: 'server-emojis-changed'; serverId: string }
  | { t: 'server-stickers-changed'; serverId: string }
  | { t: 'message-search-results'; query: string; conversationId?: string; results: SearchResult[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-send-result'; requestId: string; clientMessageId: string; message?: ChatMessage; error?: { code: string; message: string } }
  | { t: 'chat-deleted'; conversationId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'chat-embeds'; conversationId: string; msgId: number; embeds: LinkPreviewData[] }
  | { t: 'chat-action-result'; requestId: string; error?: { code: string; message: string } }
  | { t: 'invitation-updated'; invitation: InvitationCard }
  | { t: 'role-updated'; role: 'user' | 'admin' }
  // this tab's session was ended from another device (session list, password change); the server
  // disconnects right after, so the tab signs out instead of trying to reconnect
  | { t: 'session-ended' }
  | { t: 'chat-reaction-updated'; conversationId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  | { t: 'typing'; conversationId: string; userId: string; value: boolean }
  | { t: 'chat-attachment-added'; conversationId: string; msgId: number; attachment: ChatAttachment }
  // payload-free: "your friends/requests/blocks changed, refetch" — the data
  // itself only ever travels over the authorized HTTP endpoints
  | { t: 'social-changed' }
  // the account changed a setting in some tab (this one included); null is back to the default
  | { t: 'notification-settings'; scope: 'server' | 'conversation'; id: string; setting: NotificationSetting | null }
  // the scoped snapshot re-sent when this connection's known peers change
  // (same shape the welcome carries)
  | {
      t: 'presence-sync'; knownUsers: PublicUser[]; participants: Participant[]; onlineUserIds: string[]; friendIds: string[];
      presence?: Record<string, VisiblePresence>; myStatus?: OwnStatus;
    }
  // someone online changed status or custom status (never sent for "invisible": that is user-offline)
  | ({ t: 'presence-status'; userId: string } & VisiblePresence)
  // this account's status, changed from another tab or device, by automatic idle, or by expiry
  | ({ t: 'my-status' } & OwnStatus)
  | { t: 'presence-result'; requestId: string; ok: boolean }
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
