// A playground skin as the account stores it: the PNG the web app re-encodes
// (web/src/features/playground/skins/skins.ts), sent and kept as base64. The
// server never draws it; it only checks that it is a PNG of a skin's size, so
// what peers download is as small and as harmless as what a peer could send.

/** Same limit as the web app's MAX_SKIN_BYTES. */
export const MAX_SKIN_BYTES = 14 * 1024;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WIDTH = 64;
const HEIGHTS = new Set([64, 32]);

/** The base64 PNG, normalized, when it is a 64×64 or 64×32 PNG within the limit; null otherwise. */
export function parseSkinPng(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_SKIN_BYTES / 3) * 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength < 33 || bytes.byteLength > MAX_SKIN_BYTES) return null;
  if (!SIGNATURE.every((byte, i) => bytes[i] === byte)) return null;
  // the first chunk of every PNG is IHDR: width and height, big-endian, right after its name
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  if (bytes.readUInt32BE(16) !== WIDTH || !HEIGHTS.has(bytes.readUInt32BE(20))) return null;
  return bytes.toString('base64');
}
