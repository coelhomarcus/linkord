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
// Raising MIN_PROTOCOL_VERSION also drops open tabs out of their calls (they are refused and
// disconnect), so keep it for changes an old client cannot tolerate.
export const PROTOCOL_VERSION = 14;
export const MIN_PROTOCOL_VERSION = 7;

export function isClientCompatible(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION;
}
