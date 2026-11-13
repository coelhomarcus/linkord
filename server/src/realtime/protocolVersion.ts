// Bump when a wire-contract change cannot be handled by an older client; the minimum version
// is enforced at join. Version 5 introduced correlated message actions and staged uploads.
// Version 6 replaced groups with servers and channels in the welcome payload.
// Version 7 moves connection edits out of profile patches.
// Version 8 drops the per-account storage quota (no more `storage-usage` messages; `welcome.storageUsage`
// is a zeroed placeholder for version 7 tabs) and sends `welcome.maxAttachmentBytes`.
// Version 9 drops pinned conversations (`conversation-pin`, `conversation-pinned` and `pinnedAt`): the
// server ignores the unknown message and an old tab reads a missing `pinnedAt` as "not pinned", so the
// minimum stays at 7.
// Version 10 adds presence status: `presence-set`/`presence-activity` from the client, `presence-status`,
// `my-status` and `presence-result` from the server, `presence`/`myStatus` in the welcome and in
// `presence-sync`. All additive: an old tab ignores them and shows everyone online as plain "online"
// (an invisible account is still left out of its lists), so the minimum stays at 7.
// Version 11 adds voice messages: an optional `voice` on attachments (and on upload init). An old tab
// shows one as a plain audio file, so the minimum stays at 7.
// Version 12 adds server emojis: `<:name:id>`/`<a:name:id>` inside message text, `custom:<id>`
// reactions and `server-emojis-changed`. An old tab shows the token as text, a custom reaction as its
// key, and ignores the new message, so the minimum stays at 7.
// Version 13 lets a call play the sounds of any server the player is in: an optional `serverId` in
// `soundboard-play` from the client, and `fileToken` in the one from the server (what lets a listener
// outside that server fetch the file). DM calls get the soundboard too. An old tab plays what it can
// fetch and sends plays without `serverId` (the call's own server), so the minimum stays at 7.
// Version 14 adds `session-ended`, sent right before the server cuts a socket whose session the account
// ended (from its session list or a password change). An old tab ignores it and sits on "reconnecting"
// until its next reconnect is refused, which signs it out, so the minimum stays at 7.
// Version 15 adds server stickers: `stickerId` on `chat` from the client, an optional `sticker` on
// messages (and on reply references) and `server-stickers-changed`. An old tab shows a sticker as an
// empty message and ignores the new message, so the minimum stays at 7.
// Version 16 adds group mentions: `<@&roleId>` inside message text, and optional `mentionEveryone`
// and `mentionRoleIds` on messages. An old tab shows a role mention as its token and does not
// highlight a group mention, so the minimum stays at 7.
// Version 17 adds `conversation-mark-all-read` and `server-mark-all-read` from the client, answered with
// the existing `conversation-read`. An old tab never sends them, so the minimum stays at 7.
// Version 18 adds `micStarting` on participants and an optional `starting` in `mic-state`: a call's mic
// reads as starting, not muted, until the client reports it settled. Only a version 18 tab is put in
// that state (an older one would never clear it), and an old tab reads the participant as muted
// while it lasts, as before, so the minimum stays at 7.
// Version 19 adds per-server and per-channel/DM notification settings: `welcome.notificationSettings`,
// `welcome.mentionsByConversation` (the badge a muted conversation keeps) and `notification-settings`
// when the account changes one in any tab. An old tab ignores them all and
// keeps every sound and badge (pushes follow the setting on the server either way), so the minimum
// stays at 7.
// Version 20 keeps an account in one call at a time. `call-join`, `dm-call-start` and `dm-call-accept`
// take an optional `replace`; without it, a request from an account already in a call on another
// connection is refused with `call-elsewhere` (a version 20 tab offers to move the call) or, for an
// older tab, the `call-not-allowed` it already shows as a refused join. The connection that loses its
// call gets `call-replaced`; an older tab ignores it and leaves when LiveKit removes it from the room.
// The welcome and `presence-sync` now list the account's own other connections, which old tabs already
// received through `participant-joined`. So the minimum stays at 7.
// Version 21 makes link previews richer (`embeds` on messages and `chat-embeds`): optional `type`,
// `images`, `imageAlt`, `audio`, `player`, `authorName` and `authorUrl`, `video` only ever a checked
// video file, and up to 5 previews per message instead of 3. An old tab ignores the new fields and
// draws its first 3 cards, so the minimum stays at 7.
// Version 22 adds an optional `imagePlaceholder` (a ThumbHash) to link previews. An old tab ignores it
// and shows the card blank until the picture loads, as before, so the minimum stays at 7.
// Raising MIN_PROTOCOL_VERSION also drops open tabs out of their calls (they are refused and
// disconnect), so keep it for changes an old client cannot tolerate.
export const PROTOCOL_VERSION = 22;
export const MIN_PROTOCOL_VERSION = 7;
export const MIC_STARTING_PROTOCOL_VERSION = 18;
export const CALL_ELSEWHERE_PROTOCOL_VERSION = 20;

export function isClientCompatible(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION;
}
