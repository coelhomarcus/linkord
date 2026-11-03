/** A canonical 16-bit PCM WAV of silence, the shape the web client encodes. */
export function silentWav({ seconds, sampleRate = 48000, channels = 1, bits = 16, format = 1, extraChunk = false }: {
  seconds: number; sampleRate?: number; channels?: number; bits?: number; format?: number; extraChunk?: boolean;
}): Buffer {
  const dataSize = Math.round(seconds * sampleRate) * channels * (bits / 8);
  const extra = extraChunk ? Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc'), Buffer.from([0])]) : Buffer.alloc(0);
  const header = Buffer.alloc(36);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + extra.length + 8 + dataSize - 8, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(format, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  header.writeUInt16LE(channels * (bits / 8), 32);
  header.writeUInt16LE(bits, 34);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(dataSize, 4);
  return Buffer.concat([header, extra, dataHeader, Buffer.alloc(dataSize)]);
}
