// Bump when a wire-contract change cannot be handled by an older client; the minimum version
// is enforced at join. Version 5 introduced correlated message actions and staged uploads.
// Version 6 replaced groups with servers and channels in the welcome payload.
export const PROTOCOL_VERSION = 6;
export const MIN_PROTOCOL_VERSION = 6;

export function isClientCompatible(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION;
}
