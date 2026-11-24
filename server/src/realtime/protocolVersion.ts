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
// Version 23 adds an optional `imageAnimated` to link previews, and `||spoiler||` inside message text
// (a link inside one still gets its preview). An old tab ignores the field, keeps GIFs animated, and
// shows a spoiler's `||` as text, so the minimum stays at 7.
// Version 24 adds activity ("Jogando Minecraft"): `activity-set` and `activity-settings-set` from the
// client, an optional `activity` in `presence-status`, `my-status` and the presence snapshot,
// `welcome.activitySettings`, `my-activity-settings` and `activity-settings-result`. An old tab ignores
// all of it and shows no activity, so the minimum stays at 7.
// Version 25 adds pinned and saved messages: `message-pin`, `pins-list`, `pins-ack`, `message-save` and
// `saved-list` from the client; `conversation-pins-updated`, `pins-list-result`, `pins-seen`,
// `saved-updated` and `saved-list-result` from the server; an optional `pinned` on messages, a
// `pin_notice` message kind, and `welcome.unseenPins` and `welcome.savedMessageIds`. An old tab ignores
// the new messages and fields and shows a pin notice as an empty message from whoever pinned, so the
// minimum stays at 7.
// Version 26 adds the header search: `search-messages` (full text plus author, channel, content type,
// mention, date, author type and pinned filters, a sort and a page) answered with
// `search-messages-result`. An old tab keeps its search dialog on `message-search`, which stays until
// the minimum is raised, so the minimum stays at 7.
// Version 27 places activity starts on the server's clock: an optional `sentAt` in `activity-set` (the
// reporter's clock when it sent the report) and `welcome.serverTime` (the server's clock, for the
// viewer's timers). An old tab sends no `sentAt` and is taken at its word, as before, and ignores
// `serverTime`, so the minimum stays at 7.
// Version 28 syncs account preferences across devices: `welcome.preferences` and `my-preferences` (set
// through `PATCH /api/me/preferences`). An old tab ignores both and keeps the settings saved in its
// browser, so the minimum stays at 7.
// Version 29 adds `notice` (a friend request, an accepted request or a server invitation, as its push
// shows it) to every open connection of the account, so a tab or desktop app without push can show
// it. An old tab ignores it and only refreshes its lists on `social-changed`, as before, so the
// minimum stays at 7.
// Version 30 adds a game's Discord Rich Presence to its activity: an optional `rich` (details, state,
// large and small images, party, the game's own timestamps, up to two link buttons) on the report in
// `activity-set` and on `Activity` wherever one is sent. An old tab ignores it and shows the name and
// icon only, so the minimum stays at 7.
// Version 31 adds playground voice channels: `voiceMode` ('standard' | 'playground') on every channel
// of a server summary, and in a playground the LiveKit token may publish data (avatar positions). An
// old tab ignores the field and shows a playground's call as tiles, still hearing everyone, so the
// minimum stays at 7.
// Version 32 adds a playground's game chat: `playgroundChatId` (a text channel of the server, or null) on
// the playground channels of a server summary. An old tab ignores it and has no chat in the game, so the
// minimum stays at 7.
// Version 33 adds fighting in a playground: `playground-pos`, `playground-attack` and `playground-respawn`
// from the client, `playground-hit` and `playground-health` from the server (modules/playground/combat.ts).
// An old tab never reports a position, so it can be neither hit nor hit anyone, and it ignores the new
// messages, so the minimum stays at 7.
// Version 34 adds experience in a playground: `playground-xp` (your total points there) after a kill and
// in answer to a session's first position report. An old tab ignores it, so the minimum stays at 7.
// Version 35 moves fighting and experience to the playground service (playground/): the client asks for
// a pass with `playground-token` and the server answers `playground-token` (its `url` and `token`, or
// `token: null`); `playground-pos`, `-attack` and `-respawn` and the `-hit`, `-health` and `-xp` answers
// now travel on the service's own socket. This server ignores them, so an old tab plays on without
// fighting until it reloads, and the minimum stays at 7.
// Raising MIN_PROTOCOL_VERSION also drops open tabs out of their calls (they are refused and
// disconnect), so keep it for changes an old client cannot tolerate.
export const PROTOCOL_VERSION = 35;
export const MIN_PROTOCOL_VERSION = 7;
export const MIC_STARTING_PROTOCOL_VERSION = 18;
export const CALL_ELSEWHERE_PROTOCOL_VERSION = 20;

export function isClientCompatible(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION;
}
