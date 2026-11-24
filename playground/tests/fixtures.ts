/** The smallest PNG parseSkinPng takes: the signature, then an IHDR of 64 wide and `height` tall. */
export function skinPng(height = 64): string {
  const bytes = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(64, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}
