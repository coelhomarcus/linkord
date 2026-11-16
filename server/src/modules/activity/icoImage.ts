import sharp from 'sharp';

// The largest picture inside a Windows .ico (Steam's client icons), as a PNG: sharp reads none of the
// format. An entry is either a PNG as is or a bitmap without its file header; only 32-bit bitmaps,
// the ones with an alpha channel, are decoded, which is what every icon with a large size carries.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_ENTRIES = 64;
const MAX_SIDE = 1024;

interface IcoEntry { size: number; offset: number; length: number }

function entries(ico: Buffer): IcoEntry[] {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) return [];
  const count = Math.min(ico.readUInt16LE(4), MAX_ENTRIES);
  const found: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > ico.length) break;
    const offset = ico.readUInt32LE(at + 12);
    const length = ico.readUInt32LE(at + 8);
    if (offset + length > ico.length || length === 0) continue;
    found.push({ size: ico[at] || 256, offset, length });
  }
  return found.sort((a, b) => b.size - a.size);
}

/** A 32-bit bitmap entry (BITMAPINFOHEADER, rows bottom-up, BGRA, then the 1-bit mask) as a PNG. */
async function bitmapToPng(dib: Buffer): Promise<Buffer | null> {
  if (dib.length < 40) return null;
  const headerSize = dib.readUInt32LE(0);
  const width = dib.readInt32LE(4);
  const height = Math.abs(dib.readInt32LE(8)) / 2;
  const bits = dib.readUInt16LE(14);
  const compression = dib.readUInt32LE(16);
  if (bits !== 32 || (compression !== 0 && compression !== 3) || width <= 0 || width > MAX_SIDE || height !== width) return null;
  // BI_BITFIELDS with the 40-byte header puts three masks after it
  const start = headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
  const stride = width * 4;
  if (start + stride * height > dib.length) return null;
  const rgba = Buffer.alloc(stride * height);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const from = start + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const s = from + x * 4;
      const d = y * stride + x * 4;
      rgba[d] = dib[s + 2]!; rgba[d + 1] = dib[s + 1]!; rgba[d + 2] = dib[s]!; rgba[d + 3] = dib[s + 3]!;
      if (dib[s + 3]) anyAlpha = true;
    }
  }
  // an icon that leaves the alpha empty draws through its mask instead: shown opaque
  if (!anyAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** The largest readable picture of an .ico and its side in pixels, or null. */
export async function largestIcoImage(ico: Buffer): Promise<{ png: Buffer; size: number } | null> {
  for (const entry of entries(ico)) {
    const bytes = ico.subarray(entry.offset, entry.offset + entry.length);
    try {
      const png = bytes.subarray(0, 8).equals(PNG_SIGNATURE) ? Buffer.from(bytes) : await bitmapToPng(bytes);
      if (!png) continue;
      const { width, height } = await sharp(png).metadata();
      if (width && height) return { png, size: Math.min(width, height) };
    } catch {
      // a broken entry: the next size down may still be fine
    }
  }
  return null;
}
