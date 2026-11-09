export interface LevelReading {
  /** RMS of the last window, 0..1 */
  rms: number;
  /** loudest absolute sample of the last window, 0..1 */
  peak: number;
}

export interface LevelMeter {
  /** null while the audio context isn't running (no reading is possible yet) */
  read: () => LevelReading | null;
  close: () => void;
}

type AudioContextCtor = typeof AudioContext;

let shared: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
}

/** Creates (or resumes) the context inside the user's gesture: iOS Safari
 * keeps one created later, from a timer or a promise, suspended for good. It
 * is never connected to the speakers, so nothing measured here is heard. */
export function primeAudioContext(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    if (!shared || shared.state === 'closed') shared = new Ctor();
    if (shared.state === 'suspended') void shared.resume().catch(() => {});
  } catch {
    shared = null;
  }
}

export function createLevelMeter(stream: MediaStream): LevelMeter | null {
  primeAudioContext();
  const ctx = shared;
  if (!ctx) return null;
  try {
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    // float samples: the silence check needs exact zeros, which the 8-bit
    // byte view can't tell apart from a quiet room
    const data = new Float32Array(analyser.fftSize);
    return {
      read() {
        if (ctx.state !== 'running') return null;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (const sample of data) {
          sum += sample * sample;
          const abs = Math.abs(sample);
          if (abs > peak) peak = abs;
        }
        return { rms: Math.sqrt(sum / data.length), peak: Math.min(1, peak) };
      },
      close() {
        try { source.disconnect(); } catch { /* already gone */ }
      },
    };
  } catch {
    return null;
  }
}
