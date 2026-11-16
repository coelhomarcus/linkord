import sharp from 'sharp';

// How alike two icons look, to pick among SteamGridDB's community icons the one that is the game's
// real icon (Steam's own) rather than fan art: both are reduced to a tiny thumbnail and compared pixel
// by pixel. Crude, and enough: the real icon redrawn larger lands far closer than any other picture.

const SIDE = 16;

async function thumbnail(image: Buffer): Promise<Buffer> {
  return sharp(image).flatten({ background: '#000000' }).resize(SIDE, SIDE, { fit: 'cover' }).removeAlpha().raw().toBuffer();
}

/** 0 for the same picture, up to 1 for opposite ones (the mean difference of every channel). */
export async function iconDistance(a: Buffer, b: Buffer): Promise<number> {
  const [left, right] = await Promise.all([thumbnail(a), thumbnail(b)]);
  let total = 0;
  for (let i = 0; i < left.length; i++) total += Math.abs(left[i]! - right[i]!);
  return total / left.length / 255;
}
