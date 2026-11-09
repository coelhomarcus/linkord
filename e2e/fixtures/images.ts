// Pictures for the image upload specs, with no image library in the suite.

// 300x200, three frames (red, green, blue), each with a white 60px square
// at x 200-260, y 20-80, so a crop that kept its animation shows on the bytes.
const THREE_FRAME_GIF = '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';

export function threeFrameGif(): { name: string; mimeType: string; buffer: Buffer } {
  return { name: 'tres-quadros.gif', mimeType: 'image/gif', buffer: Buffer.from(THREE_FRAME_GIF, 'base64') };
}

/** A GIF's size and frame count, by walking its blocks. */
export function gifInfo(bytes: Buffer): { width: number; height: number; frames: number } {
  if (bytes.toString('ascii', 0, 3) !== 'GIF') throw new Error('not a GIF');
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  const colorTable = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  const skipSubBlocks = (at: number) => {
    while (bytes[at] !== 0) at += bytes[at]! + 1;
    return at + 1;
  };
  let at = 13 + colorTable(bytes[10]!);
  let frames = 0;
  while (at < bytes.length && bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      at = skipSubBlocks(at + 2);
    } else if (bytes[at] === 0x2c) {
      frames++;
      at = skipSubBlocks(at + 10 + colorTable(bytes[at + 9]!) + 1);
    } else {
      throw new Error(`unexpected GIF block 0x${bytes[at]!.toString(16)} at ${at}`);
    }
  }
  return { width, height, frames };
}
