// Bump when a wire-contract change cannot be handled by an older client; the minimum version
// is enforced at join. Version 5 introduced correlated message actions and staged uploads.
// Version 6 replaced groups with servers and channels in the welcome payload.
// Version 7 moves connection edits out of profile patches.
// Version 8 drops the per-account storage quota (no more `storage-usage` messages; `welcome.storageUsage`
// is a zeroed placeholder for version 7 tabs) and sends `welcome.maxAttachmentBytes`.
// Version 9 drops pinned conversations (`conversation-pin`, `conversation-pinned` and `pinnedAt`): the
// server ignores the unknown message and an old tab reads a missing `pinnedAt` as "not pinned", so the
// minimum stays at 7.
// Raising MIN_PROTOCOL_VERSION also drops open tabs out of their calls (they are refused and
// disconnect), so keep it for changes an old client cannot tolerate.
export const PROTOCOL_VERSION = 9;
export const MIN_PROTOCOL_VERSION = 7;

export function isClientCompatible(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION;
}
