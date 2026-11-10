import type { ConnectionProvider, ConnectionSnapshot, WidgetType } from '../modules/connections/types.js';
import type { GameList } from '../modules/games/types.js';
import { pgTable, text, varchar, timestamp, integer, bigint, jsonb, serial, boolean, uniqueIndex, index, primaryKey, check, customType, foreignKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { messageSearchVector } from './textSearch.js';

// Postgres tsvector has no first-class drizzle column type — customType
// just needs to know its SQL type name; the actual value is always
// computed by Postgres itself (see messages.searchVector below), never
// written from the app, so there's no fromDriver/toDriver to define.
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** An account. `username` is immutable and the room's unique login/mention
 * handle. `displayName` is the free-form, non-unique name shown everywhere
 * else — '' means "not set", every read site falls back to `username` (see
 * auth/users.ts#resolveDisplayName). */
export const users = pgTable('users', {
  // app-generated via crypto.randomUUID() instead of gen_random_uuid() to
  // avoid depending on the pgcrypto extension being installed.
  id: text('id').primaryKey(),
  username: varchar('username', { length: 20 }).notNull(),
  // Nullable for accounts created before email recovery was introduced.
  email: varchar('email', { length: 320 }),
  displayName: varchar('display_name', { length: 32 }).notNull().default(''),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar').notNull().default(''),
  // Static first-frame JPEG generated alongside an animated avatar/banner
  // (GIF/animated WebP) — '' means the current avatar/banner isn't animated
  // (or predates this column). Lets the call UI freeze on this instead of
  // the live animation until the person actually speaks (see Tile.tsx).
  avatarPoster: text('avatar_poster').notNull().default(''),
  avatarColor: varchar('avatar_color', { length: 32 }).notNull().default('blurple'),
  banner: text('banner').notNull().default(''),
  bannerPoster: text('banner_poster').notNull().default(''),
  bio: text('bio').notNull().default(''),
  profileLinks: jsonb('profile_links').$type<string[]>().notNull().default([]),
  role: varchar('role', { length: 16 }).notNull().default('user'), // 'user' | 'admin'
  // 'active' | 'suspended'. A suspended account can't hold a session at all
  // (resolveSession returns null) — see modules/admin/adminUsers.ts.
  status: varchar('status', { length: 16 }).notNull().default('active'),
  statusReason: text('status_reason').notNull().default(''),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
  // UI language (see modules/users/locale.ts for the supported list). Also
  // what e-mails and push notifications are written in, which is why it
  // lives on the account instead of only in the browser.
  locale: varchar('locale', { length: 16 }).notNull().default('pt-BR'),
  // false keeps message text out of push notifications (they show who and where only). It is read
  // by the server when it builds the push, so it lives on the account, not in the browser.
  pushShowContent: boolean('push_show_content').notNull().default(true),
  // Two-step login: with it on, a right password only earns a code sent to `email` (auth/routes.ts).
  twoFactorEmail: boolean('two_factor_email').notNull().default(false),
  // Email the account when a new browser signs in (modules/auth/loginAlert.ts).
  loginAlertEmail: boolean('login_alert_email').notNull().default(true),
  // The presence status the person picked (see modules/presence/userStatus.ts). On the account so it
  // holds on every device, and so push delivery can honour 'dnd' without asking the socket layer.
  presenceStatus: varchar('presence_status', { length: 16 }).notNull().default('online'),
  // '' text and emoji mean no custom status. A past expiry reads as none (it is also cleared then).
  customStatusEmoji: varchar('custom_status_emoji', { length: 64 }).notNull().default(''),
  customStatusText: varchar('custom_status_text', { length: 128 }).notNull().default(''),
  customStatusExpiresAt: timestamp('custom_status_expires_at', { withTimezone: true }),
  // Last time the account actually went offline (last live socket gone,
  // after the reconnect grace). Null until the first disconnect after this
  // column existed — the migration backfills from sessions.last_seen_at.
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('users_status_idx').on(t.status),
  index('users_created_at_id_idx').on(t.createdAt, t.id),
  // CASE-INSENSITIVE uniqueness: "Lune" and "lune" are the same person. The
  // chosen spelling is stored in the column; uniqueness lives in an index
  // on lower(username) — every username lookup must use that SAME
  // expression (see auth/users.ts), or Postgres won't use this index.
  uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`),
  uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`),
  check('users_presence_status_check', sql`${t.presenceStatus} IN ('online','idle','dnd','invisible')`),
]);

/** Login session. The key is the sha256 of the cookie value, never the raw
 * value — a DB leak alone can't be replayed as a session. `id` is what the
 * account's own session list shows and revokes, so the hash never leaves the
 * server. `ip` and `userAgent` are what the login came from (personal data:
 * shown only to the account itself, gone with the row). */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ip: varchar('ip', { length: 64 }).notNull().default(''),
  userAgent: varchar('user_agent', { length: 512 }).notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('sessions_user_id_idx').on(t.userId),
  uniqueIndex('sessions_id_key').on(t.id),
]);

/** The browsers an account has signed in from lately, kept apart from `sessions` because logging out
 * deletes the session row and a plain re-login must not read as a new browser. `fingerprint` is the
 * sha256 of the address plus the user agent, so no raw address is kept here. */
export const knownLogins = pgTable('known_logins', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fingerprint: text('fingerprint').notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.fingerprint] }),
  index('known_logins_last_login_at_idx').on(t.lastLoginAt),
]);

/** Short-lived one-time codes for account recovery and email changes. Only
 * the hash is stored, so a database read cannot be used to recover a code. */
export const authCodes = pgTable('auth_codes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: varchar('purpose', { length: 32 }).notNull(), // see AuthCodePurpose in auth/codes.ts
  email: varchar('email', { length: 320 }).notNull(),
  // sha256 of the login challenge a 'login' code belongs to (null for every other purpose), so the
  // code can only finish the login it was sent for
  challengeHash: text('challenge_hash'),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('auth_codes_user_purpose_idx').on(t.userId, t.purpose),
  index('auth_codes_email_purpose_idx').on(t.email, t.purpose),
  index('auth_codes_challenge_hash_idx').on(t.challengeHash),
]);

/** DMs are unique per sorted member pair; server channels share this table via `serverId`.
 * Keep the timestamps distinct: `lastMessageAt` controls DM visibility/order, `updatedAt`
 * tracks row edits, and `lastActivityAt` records broader activity without affecting either. */
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  type: varchar('type', { length: 12 }).notNull(), // 'direct' | 'text' | 'voice'
  // a channel's name; always '' on a DM
  title: varchar('title', { length: 80 }).notNull().default(''),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  dmKey: text('dm_key'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  // Set on a server channel, null on a DM. Suspension lives on the server.
  serverId: text('server_id').references((): AnyPgColumn => servers.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references((): AnyPgColumn => serverCategories.id, { onDelete: 'set null' }),
  position: integer('position').notNull().default(0),
  topic: text('topic').notNull().default(''),
  // true: the channel follows its category's permission overwrites instead
  // of its own (Discord's "synced with category")
  permissionsSynced: boolean('permissions_synced').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('conversations_dm_key_unique').on(t.dmKey),
  index('conversations_server_id_idx').on(t.serverId, t.position),
  index('conversations_type_idx').on(t.type),
  check('conversations_type_check', sql`${t.type} IN ('direct','text','voice')`),
  check('conversations_server_channel_check', sql`(${t.type} = 'direct') = (${t.serverId} IS NULL)`),
]);

/** The two members of a DM. Server channels have no rows here: who belongs
 * to a server is `server_members`, and who sees a channel is resolved from
 * its roles (modules/servers/permissions.ts). `role` is a leftover of groups
 * and always 'member'. */
export const conversationMembers = pgTable('conversation_members', {
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('member'), // 'owner' | 'member'
  lastReadMessageId: integer('last_read_message_id'),
  // set when this member "closes" a direct conversation (Discord-style —
  // leaves their own history list without deleting anything). listForUser
  // hides it again until a message newer than this arrives.
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('conversation_members_conversation_user_key').on(t.conversationId, t.userId),
  index('conversation_members_user_id_idx').on(t.userId),
  index('conversation_members_conversation_id_idx').on(t.conversationId),
]);

/** A Discord-style server: the owner of its channels (`conversations` rows
 * with `serverId`), roles and members. `ownerId` is null only for a legacy
 * group that had no members left when it was migrated — an admin can assign
 * one (modules/admin). Suspension blocks every channel at once. */
export const servers = pgTable('servers', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  icon: text('icon').notNull().default(''),
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 16 }).notNull().default('active'), // 'active' | 'suspended'
  statusReason: text('status_reason').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('servers_status_created_idx').on(t.status, t.createdAt, t.id),
  index('servers_owner_id_idx').on(t.ownerId),
  check('servers_status_check', sql`${t.status} IN ('active','suspended')`),
]);

/** Server membership — the single source of truth for who belongs. Access
 * to a channel is this row plus the channel's resolved VIEW_CHANNEL
 * (modules/servers/permissions.ts), never a per-channel row. `position` is
 * the member's own order of the server in their rail. */
export const serverMembers = pgTable('server_members', {
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.serverId, t.userId] }),
  index('server_members_user_id_idx').on(t.userId),
]);

/** A server role. Exactly one per server is @everyone (`isDefault`, position
 * 0), held implicitly by every member and never assigned. Higher `position`
 * outranks lower. `permissions` is the bitfield of modules/servers/permissions.ts. */
export const serverRoles = pgTable('server_roles', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 16 }).notNull().default(''),
  position: integer('position').notNull().default(0),
  permissions: integer('permissions').notNull().default(0),
  // shown as its own section of the member list
  hoist: boolean('hoist').notNull().default(false),
  mentionable: boolean('mentionable').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('server_roles_server_id_idx').on(t.serverId, t.position),
  uniqueIndex('server_roles_one_default_idx').on(t.serverId).where(sql`${t.isDefault}`),
]);

/** Which roles a member holds. Keyed to the membership, so leaving or being
 * removed from a server takes the member's roles along. */
export const serverMemberRoles = pgTable('server_member_roles', {
  serverId: text('server_id').notNull(),
  userId: text('user_id').notNull(),
  roleId: text('role_id').notNull().references(() => serverRoles.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index('server_member_roles_server_id_idx').on(t.serverId),
  foreignKey({ columns: [t.serverId, t.userId], foreignColumns: [serverMembers.serverId, serverMembers.userId] }).onDelete('cascade'),
]);

export const serverCategories = pgTable('server_categories', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('server_categories_server_id_idx').on(t.serverId, t.position),
]);

/** A permission overwrite on one channel or one category, for one role or
 * one member. `allow` and `deny` are bitfields; a bit in neither inherits. */
export const channelPermissionOverwrites = pgTable('channel_permission_overwrites', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').references(() => conversations.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => serverCategories.id, { onDelete: 'cascade' }),
  roleId: text('role_id').references(() => serverRoles.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  allow: integer('allow').notNull().default(0),
  deny: integer('deny').notNull().default(0),
}, (t) => [
  index('channel_permission_overwrites_server_id_idx').on(t.serverId),
  // ids are uuids, so a channel id never collides with a category id (nor a
  // role id with a user id) and one expression index covers all four shapes
  uniqueIndex('channel_permission_overwrites_target_subject_key').on(sql`coalesce(${t.channelId}, ${t.categoryId})`, sql`coalesce(${t.roleId}, ${t.userId})`),
  check('channel_permission_overwrites_one_target_check', sql`num_nonnulls(${t.channelId}, ${t.categoryId}) = 1`),
  check('channel_permission_overwrites_one_subject_check', sql`num_nonnulls(${t.roleId}, ${t.userId}) = 1`),
]);

/** A member's read position in a server channel — what
 * `conversation_members.lastReadMessageId` is for a DM. No row means
 * nothing read yet; unread counts start at the member's server `joinedAt`. */
export const channelReadStates = pgTable('channel_read_states', {
  channelId: text('channel_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadMessageId: integer('last_read_message_id'),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.userId] }),
  index('channel_read_states_user_id_idx').on(t.userId),
]);

/** An invite link (`/invite/<code>`). Anyone signed in with the code joins,
 * unlike a friend invitation (server_invitations) which names its invitee. */
export const serverInvites = pgTable('server_invites', {
  code: varchar('code', { length: 16 }).primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  // the channel the invite lands on; falls back to the first visible one
  channelId: text('channel_id').references(() => conversations.id, { onDelete: 'set null' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  maxUses: integer('max_uses'), // null = unlimited
  uses: integer('uses').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }), // null = never
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('server_invites_server_id_idx').on(t.serverId),
]);

/** A ban: the account can't rejoin by link or invitation until it's lifted. */
export const serverBans = pgTable('server_bans', {
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bannedBy: text('banned_by').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.serverId, t.userId] }),
]);

/** A server's own audit log: who changed what in it, shown to members with
 * VIEW_AUDIT_LOG. Written in the same transaction as the change it records
 * (modules/servers/serverAuditLog.ts). Actor and target are ids plus a label
 * snapshot with no foreign key, so an entry outlives the account, role or
 * channel it names; the log itself goes with its server. `detail` holds the
 * before/after of what changed, never message bodies or tokens. */
export const serverAuditLogs = pgTable('server_audit_logs', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  actorId: text('actor_id'),
  actorLabel: text('actor_label').notNull().default(''),
  action: varchar('action', { length: 48 }).notNull(),
  targetType: varchar('target_type', { length: 16 }).notNull(),
  targetId: text('target_id').notNull().default(''),
  targetLabel: text('target_label').notNull().default(''),
  reason: text('reason').notNull().default(''),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('server_audit_server_created_idx').on(t.serverId, t.createdAt, t.id),
  index('server_audit_server_actor_idx').on(t.serverId, t.actorId, t.createdAt),
  index('server_audit_server_action_idx').on(t.serverId, t.action, t.createdAt),
  index('server_audit_server_target_idx').on(t.serverId, t.targetId, t.createdAt),
  // the retention sweep picks the oldest rows across every server
  index('server_audit_created_idx').on(t.createdAt),
]);

/** One row per canonical account pair. `requestedBy` identifies who is waiting while the
 * request is pending; `version` prevents stale accepts from racing newer requests. */
export const friendships = pgTable('friendships', {
  id: text('id').primaryKey(),
  userLowId: text('user_low_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userHighId: text('user_high_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestedBy: text('requested_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // 'pending' | 'accepted' | 'declined' | 'cancelled' | 'removed'
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  retryAfter: timestamp('retry_after', { withTimezone: true }),
}, (t) => [
  uniqueIndex('friendships_pair_key').on(t.userLowId, t.userHighId),
  index('friendships_user_high_id_idx').on(t.userHighId),
  index('friendships_status_idx').on(t.status),
  check('friendships_pair_order_check', sql`${t.userLowId} < ${t.userHighId}`),
  check('friendships_requester_in_pair_check', sql`${t.requestedBy} = ${t.userLowId} OR ${t.requestedBy} = ${t.userHighId}`),
  check('friendships_status_check', sql`${t.status} IN ('pending','accepted','declined','cancelled','removed')`),
]);

/** Directional block — no surrogate id, same reasoning as
 * `messageReactions`: nothing ever references a single block row on its
 * own. The two sides are independent: `blockerId` unblocking doesn't touch
 * whatever `blockedId` may have done on their own row. */
export const userBlocks = pgTable('user_blocks', {
  blockerId: text('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedId: text('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.blockerId, t.blockedId] }),
  index('user_blocks_blocked_id_idx').on(t.blockedId), // "who blocked me"
  check('user_blocks_different_users_check', sql`${t.blockerId} <> ${t.blockedId}`),
]);

/** A friend's invitation to a server, delivered as a card in their DM — a
 * pending invite is NOT membership. Cascades when the server is deleted —
 * an invite to a server that no longer exists is meaningless, and
 * `messages.serverInvitationId` (below) is what keeps the DM card alive as a
 * tombstone instead of disappearing. Invite LINKS are server_invites. */
export const serverInvitations = pgTable('server_invitations', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  inviterId: text('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  inviteeId: text('invitee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // legacy: invitations no longer expire (null); old rows may still carry one
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
}, (t) => [
  // at most one PENDING invite per (server, invitee) — a re-invite after
  // decline/expiry resolves the old row first, doesn't get blocked here.
  uniqueIndex('server_invitations_pending_unique').on(t.serverId, t.inviteeId).where(sql`${t.status} = 'pending'`),
  index('server_invitations_invitee_status_idx').on(t.inviteeId, t.status),
  index('server_invitations_server_id_idx').on(t.serverId),
  check('server_invitations_status_check', sql`${t.status} IN ('pending','accepted','declined','revoked','expired')`),
]);

/** Chat message, now persisted (used to live only in memory, lost on
 * every restart). `authorId` is SET NULL if the account is later deleted.
 * Mutable profile data (display name/avatar/color) intentionally lives only
 * on `users`; chat rows resolve it with a join when they are read, so a
 * profile change updates the whole history without rewriting messages. */
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  replyTo: jsonb('reply_to'),
  kind: varchar('kind', { length: 16 }).notNull().default('text'), // 'text' | 'server_invite' | 'call_invite' | 'dm_call'
  // Keep the card as a tombstone if its invitation is deleted.
  serverInvitationId: text('server_invitation_id').references(() => serverInvitations.id, { onDelete: 'set null' }),
  // The voice channel (or DM) whose call a `call_invite` card asks the
  // recipient to join. SET NULL for the same reason as above.
  callConversationId: text('call_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  // Whole seconds of talk time on a dm_call. Null when the call was never answered.
  callDurationSeconds: integer('call_duration_seconds'),
  // Set (with authorId null) on a message a bot's webhook posted. SET NULL so
  // a deleted webhook leaves its history behind instead of taking it along.
  webhookId: text('webhook_id').references(() => webhooks.id, { onDelete: 'set null' }),
  // The sender's Idempotency-Key: a retry of the same delivery finds this row
  // instead of posting twice. Unique per webhook, null when none was sent.
  webhookDeliveryKey: varchar('webhook_delivery_key', { length: 128 }),
  // The structured cards a bot posted with the message (modules/bots/richEmbeds.ts),
  // normalized before storing. Null on every message an account wrote.
  richEmbeds: jsonb('rich_embeds').$type<unknown[]>(),
  // The link previews of the message's cards (one per previewable link, see
  // modules/link-preview/messageLinks.ts), fetched once after it is sent
  // (modules/messages/messageEmbeds.ts) so history ships each card at its
  // final size instead of every reader fetching it after it is already on
  // screen. Null until fetched; an entry only shows while its `url` is still
  // one of the message's links (an edit can change them).
  embeds: jsonb('embeds'),
  // Links whose card the author removed (Discord's "remove embed"): the link
  // stays in the text, its card is no longer drawn, and it is never fetched
  // again. Null when none is. Pruned to the message's links on edit.
  suppressedEmbeds: jsonb('suppressed_embeds').$type<string[]>(),
  // The server sticker the message is (its whole body: the text is empty).
  // Deliberately no foreign key: the message keeps pointing at a deleted
  // sticker, which is how readers know to draw "sticker unavailable" instead
  // of a blank message (a SET NULL would erase that it ever was one).
  stickerId: text('sticker_id'),
  // The group mentions that notified someone (modules/messages/groupMentions.ts),
  // decided once when the message is sent or edited, with the author's
  // permission at that moment: readers highlight a message by these, never by
  // the text, which says "@everyone" just the same when it pinged nobody.
  // `mentionEveryone` covers @here too.
  mentionEveryone: boolean('mention_everyone').notNull().default(false),
  mentionRoleIds: text('mention_role_ids').array(),
  // Postgres computes/maintains this itself (GENERATED ALWAYS AS ... STORED)
  // on every insert/update of `text` — never set from the app. Stored rather
  // than an expression index so ranking reads it instead of re-parsing every
  // match. The configs it is built from are in db/textSearch.ts; the query
  // side is modules/messages/messages.ts#handleMessageSearch.
  searchVector: tsvector('search_vector').generatedAlwaysAs((): SQL => messageSearchVector(messages.text)),
}, (t) => [
  index('messages_conversation_id_idx').on(t.conversationId),
  index('messages_search_vector_idx').using('gin', t.searchVector),
  // Substring search in the media panel's links/GIFs (`ilike '%q%'`, see
  // modules/attachments/media.ts), which a word index can't answer.
  index('messages_text_trgm_idx').using('gin', t.text.op('gin_trgm_ops')),
  index('messages_server_invitation_id_idx').on(t.serverInvitationId),
  index('messages_webhook_id_idx').on(t.webhookId),
  uniqueIndex('messages_webhook_delivery_key_unique').on(t.webhookId, t.webhookDeliveryKey).where(sql`${t.webhookDeliveryKey} IS NOT NULL`),
  index('messages_call_conversation_id_idx').on(t.callConversationId),
  check('messages_kind_reference_check', sql`(${t.kind} = 'text' AND ${t.serverInvitationId} IS NULL AND ${t.callConversationId} IS NULL) OR (${t.kind} = 'server_invite' AND ${t.callConversationId} IS NULL) OR (${t.kind} = 'call_invite' AND ${t.serverInvitationId} IS NULL) OR (${t.kind} = 'dm_call' AND ${t.serverInvitationId} IS NULL AND ${t.callConversationId} IS NULL)`),
  check('messages_call_duration_kind_check', sql`${t.callDurationSeconds} IS NULL OR ${t.kind} = 'dm_call'`),
]);

/** The credential an outside system posts into a bot conversation with. Only
 * a sha256 of the token is kept: whoever can read the database still can't
 * post as the bot, and the token is shown once, when created or rotated. */
export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  // The name and picture its messages are shown under — a bot used to borrow
  // its conversation's, but a channel can host several webhooks.
  name: varchar('name', { length: 80 }).notNull().default(''),
  avatar: text('avatar').notNull().default(''),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  tokenRotatedAt: timestamp('token_rotated_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (t) => [
  index('webhooks_conversation_id_idx').on(t.conversationId),
]);

// One row per send intent (the client's clientMessageId), so a retry after a
// lost reply returns the original message instead of inserting a second one.
// Kept apart from `messages` on purpose: deleting the message SETs NULL here
// instead of erasing the record, so a late retry of a deleted message can't
// quietly bring it back. Swept after a retention window (see
// modules/messages/sendOperations.ts).
export const messageSendOperations = pgTable('message_send_operations', {
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientMessageId: varchar('client_message_id', { length: 64 }).notNull(),
  // hash of the canonical payload: the same key with different content is a
  // conflict, not a retry
  payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.authorId, t.clientMessageId] }),
  index('message_send_operations_created_at_idx').on(t.createdAt),
  index('message_send_operations_message_id_idx').on(t.messageId),
]);

export type MessageSendOperation = typeof messageSendOperations.$inferSelect;

/** The natural key prevents duplicate reactions per user and emoji.
 * Both foreign keys cascade because reactions have no meaning without their message or reactor. */
export const messageReactions = pgTable('message_reactions', {
  messageId: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // a Unicode emoji (same cap as isSingleEmoji, messages/emoji.ts) or `custom:<id>` for a server emoji
  emoji: varchar('emoji', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
  index('message_reactions_message_id_idx').on(t.messageId),
]);

/** Attachment rows may represent message files, profile images, or generated thumbnails.
 * Database cascades do not remove disk files; cleanup must go through the attachment helpers.
 * Thumbnail rows share their parent's message so they follow its cascade and quota accounting. */
export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  // Set only for profile images. It prevents another account from claiming a public
  // `/uploads/<id>` URL and deleting the real owner's file; retain the file if its uploader is deleted.
  uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  // bigint (not integer): the attachment cap is configurable (MAX_ATTACHMENT_BYTES)
  // and may be set past Postgres's int4 (max 2,147,483,647). mode:
  // 'number' is safe here — a real file size never gets close to
  // Number.MAX_SAFE_INTEGER.
  size: bigint('size', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Points at another row's `id` in THIS same table — the resized preview
  // generated for an image attachment (see attachments.ts#generateThumbnail).
  // No FK: it's a soft, optional link, same spirit as the nullable
  // `messageId` above. Null when there's no thumbnail (non-image, animation
  // too small to bother, or generation failed — never fatal to the upload).
  thumbId: text('thumb_id'),
  // True ONLY on the thumbnail row itself (messageId set to the SAME
  // message as its parent, on purpose — see attachments.ts#generateThumbnail
  // for why: it has to ride the parent's cascade-delete/quota-counting,
  // but must NOT show up as a second, duplicate attachment of that message).
  // Every query that lists "this message's attachments" must filter
  // isThumbnail = false (see getByMessageIds, modules/media.ts).
  isThumbnail: boolean('is_thumbnail').notNull().default(false),
  // Order within the message, as the sender picked the files — not when
  // each upload happened to finish. Legacy rows are all 0 and fall back to
  // createdAt.
  position: integer('position').notNull().default(0),
  // Displayed size of an image (EXIF orientation applied), read on upload,
  // so the client reserves its box before the pixels arrive. Null for other
  // types, for files that couldn't be read, and for rows from before this.
  width: integer('width'),
  height: integer('height'),
  // A few dozen bytes (base64 ThumbHash) of a blurred stand-in for the image,
  // so its box is not empty while the pixels load. Same nulls as width/height.
  placeholder: text('placeholder'),
  // Set together, only on an audio file recorded as a voice message. The
  // duration comes from the recorder: MediaRecorder output often carries none.
  voiceDurationMs: integer('voice_duration_ms'),
  // base64, one byte (0-255) per bar of the player's waveform
  voiceWaveform: text('voice_waveform'),
}, (t) => [
  index('attachments_message_id_idx').on(t.messageId),
]);

// A file fully uploaded but not yet part of any message: the batch it belongs
// to is published in one step (see modules/messages/messages.ts, correlated
// chat with attachmentIds). Its own table on purpose — an `attachments` row
// with no message means a public profile image, and a staged file must never
// be served to anyone. The file lives on disk under the same id; its bytes
// count against the owner's quota while it waits here.
export const stagedAttachments = pgTable('staged_attachments', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  thumbId: text('thumb_id'),
  thumbMimeType: text('thumb_mime_type'),
  thumbSize: bigint('thumb_size', { mode: 'number' }),
  width: integer('width'),
  height: integer('height'),
  placeholder: text('placeholder'),
  voiceDurationMs: integer('voice_duration_ms'),
  voiceWaveform: text('voice_waveform'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('staged_attachments_owner_id_idx').on(t.ownerId),
  index('staged_attachments_expires_at_idx').on(t.expiresAt),
]);

export type StagedAttachment = typeof stagedAttachments.$inferSelect;

// A server's soundboard. Its own table rather than an `attachments` row for the
// same reason as staged files: a message-less attachment is a public profile
// image, while a sound is only for the server's members. The file lives on disk
// under the row's id; `size` is counted in the instance-wide storage total.
export const serverSounds = pgTable('server_sounds', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  // set null, not cascade: the sound belongs to the server, not to whoever sent it
  uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 32 }).notNull(),
  emoji: varchar('emoji', { length: 16 }).notNull().default(''),
  // 0..100, applied on top of each listener's own soundboard volume
  volume: integer('volume').notNull().default(100),
  size: integer('size').notNull(),
  durationMs: integer('duration_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('server_sounds_server_id_idx').on(t.serverId, t.createdAt),
  check('server_sounds_volume_range', sql`${t.volume} BETWEEN 0 AND 100`),
]);

export type ServerSound = typeof serverSounds.$inferSelect;

/** A server's own emojis, used as `<:name:id>` (`<a:name:id>` when animated) in messages and as
 * `custom:<id>` reactions anywhere by its members (modules/emojis). The file is a 128px WebP stored
 * under the emoji's id in the uploads folder and counted in the instance's storage, like a sound. */
export const serverEmojis = pgTable('server_emojis', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  // set null, not cascade: the emoji belongs to the server, not to whoever sent it
  uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 32 }).notNull(),
  animated: boolean('animated').notNull().default(false),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('server_emojis_server_name_key').on(t.serverId, t.name),
  check('server_emojis_name_check', sql`${t.name} ~ '^[a-z0-9_]{2,32}$'`),
]);

export type ServerEmoji = typeof serverEmojis.$inferSelect;

/** A server's stickers: one is a whole message (`messages.sticker_id`), drawn large, sent anywhere by
 * the server's members and seen by anyone who reads it (modules/stickers). The file is a 320px WebP
 * stored under the sticker's id in the uploads folder and counted in the instance's storage. */
export const serverStickers = pgTable('server_stickers', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  // set null, not cascade: the sticker belongs to the server, not to whoever sent it
  uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 30 }).notNull(),
  // read aloud by screen readers in place of the picture; '' when none was given
  description: varchar('description', { length: 100 }).notNull().default(''),
  // one Unicode emoji the sticker stands for: what the picker's search also matches
  emoji: varchar('emoji', { length: 16 }).notNull(),
  animated: boolean('animated').notNull().default(false),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('server_stickers_server_name_key').on(t.serverId, sql`lower(${t.name})`),
]);

export type ServerSticker = typeof serverStickers.$inferSelect;

/** Inbox and read state for a social event. Typed foreign keys preserve referential integrity;
 * deterministic `dedupeKey` values make retried outbox writes idempotent. Reading a notification
 * does not change the friendship or invitation state. */
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  recipientId: text('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 32 }).notNull(), // 'friend_request' | 'friend_accepted' | 'server_invitation' | 'mention'
  friendshipId: text('friendship_id').references(() => friendships.id, { onDelete: 'cascade' }),
  serverInvitationId: text('server_invitation_id').references(() => serverInvitations.id, { onDelete: 'cascade' }),
  // the message that @mentioned the recipient: deleting it takes the notification along
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('notifications_dedupe_key_unique').on(t.dedupeKey),
  index('notifications_recipient_created_idx').on(t.recipientId, t.createdAt),
  index('notifications_recipient_unread_idx').on(t.recipientId).where(sql`${t.readAt} IS NULL`),
  index('notifications_message_id_idx').on(t.messageId),
  check('notifications_kind_reference_check', sql`
    (${t.kind} IN ('friend_request','friend_accepted') AND ${t.friendshipId} IS NOT NULL AND ${t.serverInvitationId} IS NULL AND ${t.messageId} IS NULL)
    OR (${t.kind} = 'server_invitation' AND ${t.serverInvitationId} IS NOT NULL AND ${t.friendshipId} IS NULL AND ${t.messageId} IS NULL)
    OR (${t.kind} = 'mention' AND ${t.messageId} IS NOT NULL AND ${t.friendshipId} IS NULL AND ${t.serverInvitationId} IS NULL)
  `),
]);

/** Write events in the same transaction as their state change to avoid losing socket notifications
 * after commit. Payloads contain ids only; the worker revalidates authorization when delivering. */
export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  type: varchar('type', { length: 64 }).notNull(), // e.g. 'friend_request_created', 'group_invitation_created'
  audienceUserId: text('audience_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leaseToken: text('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
}, (t) => [
  index('outbox_events_ready_idx').on(t.nextAttemptAt, t.createdAt).where(sql`${t.processedAt} IS NULL`),
  index('outbox_events_audience_user_id_idx').on(t.audienceUserId),
]);

export const pushDeliveryReceipts = pgTable('push_delivery_receipts', {
  eventId: text('event_id').notNull().references(() => outboxEvents.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventId, t.endpoint] })]);

/** One browser installation's Web Push address. A browser can reuse the same
 * endpoint after a different account signs in, so the endpoint is unique and
 * its owner is replaced on registration. */
export const pushSubscriptions = pgTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('push_subscriptions_user_id_idx').on(t.userId)]);

/** A connection that is in a call right now. Lets a restarted server rebuild the
 * participant under the same id (the LiveKit identity) and token, so a deploy
 * looks like a short network drop to everyone in the call. Only membership is
 * kept: mic, camera and share flags are re-reported by the client on reconnect. */
export const callPresence = pgTable('call_presence', {
  participantId: text('participant_id').primaryKey(),
  token: text('token').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  deafened: boolean('deafened').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('call_presence_user_id_idx').on(t.userId)]);

/** A ringing or answered DM call, mirrored from the in-memory state machine so
 * a restart does not drop it. A row exists only while the call is live. */
export const dmCallsActive = pgTable('dm_calls_active', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  callerId: text('caller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  calleeId: text('callee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  callerParticipantId: text('caller_participant_id').notNull(),
  calleeParticipantId: text('callee_participant_id'),
  video: boolean('video').notNull(),
  phase: varchar('phase', { length: 8 }).$type<'ringing' | 'active'>().notNull(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  answeredAt: bigint('answered_at', { mode: 'number' }),
}, (t) => [
  check('dm_calls_active_phase_check', sql`${t.phase} IN ('ringing','active')`),
]);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuthCode = typeof authCodes.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type Friendship = typeof friendships.$inferSelect;
export type UserBlock = typeof userBlocks.$inferSelect;
export type ServerInvitation = typeof serverInvitations.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type ServerMember = typeof serverMembers.$inferSelect;
export type ServerRole = typeof serverRoles.$inferSelect;
export type ServerCategory = typeof serverCategories.$inferSelect;
export type ChannelPermissionOverwrite = typeof channelPermissionOverwrites.$inferSelect;
export type ServerInvite = typeof serverInvites.$inferSelect;
export type ServerAuditLog = typeof serverAuditLogs.$inferSelect;

/** Append-only record of administrative actions. No foreign keys on purpose:
 * the trail must outlive the account or group it is about (and the admin who
 * acted), so actor/target are stored as ids plus a label snapshot. The
 * application only ever INSERTs here. `detail` never carries passwords,
 * cookies, tokens or conversation bodies. */
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  actorLabel: text('actor_label').notNull().default(''),
  action: varchar('action', { length: 48 }).notNull(),
  targetType: varchar('target_type', { length: 16 }).notNull(), // 'user' | 'server' | 'group' (before servers) | 'message' | 'report' | 'system'
  targetId: text('target_id').notNull().default(''),
  targetLabel: text('target_label').notNull().default(''),
  reason: text('reason').notNull().default(''),
  result: varchar('result', { length: 16 }).notNull().default('ok'), // 'ok' | 'failed'
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  requestId: text('request_id').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('admin_audit_created_id_idx').on(t.createdAt, t.id),
  index('admin_audit_actor_idx').on(t.actorId, t.createdAt),
  index('admin_audit_target_idx').on(t.targetType, t.targetId, t.createdAt),
  index('admin_audit_action_idx').on(t.action, t.createdAt),
  check('admin_audit_result_check', sql`${t.result} IN ('ok','failed')`),
]);

/** A user's report about an account, a group or a message. `snapshot` keeps
 * the only evidence there is — for a message, its text at the moment of the
 * report (capped) — so the case survives the author editing or deleting it;
 * an admin never gets to read anything else in the conversation. The reporter
 * is never shown to the reported account. */
export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  targetType: varchar('target_type', { length: 16 }).notNull(), // 'user' | 'server' | 'message'
  targetId: text('target_id').notNull(),
  targetLabel: text('target_label').notNull().default(''),
  category: varchar('category', { length: 24 }).notNull(),
  details: text('details').notNull().default(''),
  status: varchar('status', { length: 16 }).notNull().default('open'), // 'open' | 'reviewing' | 'resolved' | 'dismissed'
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  resolution: varchar('resolution', { length: 24 }).notNull().default(''),
  resolutionNote: text('resolution_note').notNull().default(''),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  index('reports_status_created_idx').on(t.status, t.createdAt, t.id),
  index('reports_target_idx').on(t.targetType, t.targetId),
  // one live report per reporter and target — a second click is not a second case
  uniqueIndex('reports_open_unique').on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status} IN ('open','reviewing')`),
  check('reports_target_type_check', sql`${t.targetType} IN ('user','server','message')`),
  check('reports_status_check', sql`${t.status} IN ('open','reviewing','resolved','dismissed')`),
]);

/** Audit record for legacy-data repairs. The repair script creates this table before migrations;
 * this definition keeps Drizzle and the migration history in sync. */
export const dataRepairs = pgTable('data_repairs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  kind: varchar('kind', { length: 32 }).notNull(),
  targetType: varchar('target_type', { length: 16 }).notNull(),
  targetId: text('target_id').notNull(),
  before: jsonb('before').$type<Record<string, unknown>>().notNull().default({}),
  after: jsonb('after').$type<Record<string, unknown>>().notNull().default({}),
  note: text('note').notNull().default(''),
  needsReview: boolean('needs_review').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('data_repairs_run_idx').on(t.runId),
  index('data_repairs_target_idx').on(t.targetType, t.targetId),
]);

export const profileConnections = pgTable('profile_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 16 }).$type<ConnectionProvider>().notNull(),
  value: text('value').notNull(),
  url: text('url').notNull(),
  position: integer('position').notNull(),
  /** off: kept for the owner, but left out of the public links and the Wall */
  showOnProfile: boolean('show_on_profile').notNull().default(true),
  snapshot: jsonb('snapshot').$type<ConnectionSnapshot>(),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  nextSyncAt: timestamp('next_sync_at', { withTimezone: true }).notNull().defaultNow(),
  syncError: varchar('sync_error', { length: 32 }),
  attempts: integer('attempts').notNull().default(0),
  leaseToken: text('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
}, (t) => [
  index('profile_connections_user_idx').on(t.userId, t.position),
  index('profile_connections_due_idx').on(t.nextSyncAt),
  uniqueIndex('profile_connections_service_unique').on(t.userId, t.provider).where(sql`${t.provider} <> 'url'`),
  uniqueIndex('profile_connections_url_unique').on(t.userId, sql`lower(${t.url})`),
  check('profile_connections_provider_check', sql`${t.provider} IN ('url','myanimelist','github')`),
]);
export type ProfileConnection = typeof profileConnections.$inferSelect;

export const profileWallWidgets = pgTable('profile_wall_widgets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** null for the games widgets: they have no external account, their data is `profile_games` */
  connectionId: text('connection_id').references(() => profileConnections.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).$type<WidgetType>().notNull(),
  position: integer('position').notNull(),
}, (t) => [
  uniqueIndex('profile_wall_widgets_connection_type_unique').on(t.connectionId, t.type),
  uniqueIndex('profile_wall_widgets_games_unique').on(t.userId, t.type).where(sql`${t.connectionId} IS NULL`),
  index('profile_wall_widgets_user_idx').on(t.userId, t.position),
  check('profile_wall_widgets_type_check', sql`${t.type} IN ('mal-recent-anime','github-profile','github-calendar','igdb-favorite-game','igdb-liked-games','igdb-playing-games','igdb-wishlist-games')`),
  check('profile_wall_widgets_owner_check', sql`(${t.connectionId} IS NULL) = (${t.type} LIKE 'igdb-%')`),
]);

/** The games a user picked, one row per game and list. Name and cover are copied when picked. */
export const profileGames = pgTable('profile_games', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  list: varchar('list', { length: 16 }).$type<GameList>().notNull(),
  igdbId: integer('igdb_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  coverImageId: varchar('cover_image_id', { length: 40 }),
  releaseYear: integer('release_year'),
  position: integer('position').notNull(),
}, (t) => [
  uniqueIndex('profile_games_list_game_unique').on(t.userId, t.list, t.igdbId),
  index('profile_games_user_list_idx').on(t.userId, t.list, t.position),
  check('profile_games_list_check', sql`${t.list} IN ('favorite','liked','playing','wishlist')`),
]);

/** Attempt counters that guard against brute force (login, recovery codes, sign-up), kept in the
 * database so a restart or a deploy does not hand out fresh attempts. One row per key (a SHA-256 of it, so
 * no email, username or address is stored) and window:
 * the row is reset in place when its window ends, and swept once it is over (modules/auth/ratelimit.ts). */
export const rateLimitWindows = pgTable('rate_limit_windows', {
  key: varchar('key', { length: 64 }).primaryKey(),
  count: integer('count').notNull(),
  windowEndsAt: timestamp('window_ends_at', { withTimezone: true }).notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
}, (t) => [
  index('rate_limit_windows_window_ends_idx').on(t.windowEndsAt),
]);

export const connectionSyncLimits = pgTable('connection_sync_limits', {
  provider: varchar('provider', { length: 16 }).primaryKey(),
  nextRequestAt: timestamp('next_request_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Keys the instance makes for itself on first boot, so a deploy needs no
 * extra configuration and every restart (or instance) signs the same way. */
export const instanceSecrets = pgTable('instance_secrets', {
  name: varchar('name', { length: 32 }).primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** How often an account used each emoji (and, with kind 'sound', each soundboard sound; with kind
 * 'sticker', each server sticker): what the
 * pickers and the composer's suggestions list first, the same on every device. Written by the
 * server as the expression is used, never by the client. `key` is the emoji itself, `custom:<id>`
 * for a server emoji, or the sound or sticker id. Pruned to the most used per kind (expressionUsage.ts). */
export const userExpressionUsage = pgTable('user_expression_usage', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 8 }).notNull(),
  key: varchar('key', { length: 64 }).notNull(),
  count: integer('count').notNull().default(1),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.kind, t.key] }),
  check('user_expression_usage_kind_check', sql`${t.kind} IN ('emoji','sound','sticker')`),
]);
