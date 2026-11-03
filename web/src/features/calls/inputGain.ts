import type { AudioProcessorOptions, LocalAudioTrack, Track, TrackProcessor } from 'livekit-client';

/** The browser has no capture constraint for level, so "Volume de entrada"
 * routes the published mic through a Web Audio gain node. */
class InputGainProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'input-gain';
  processedTrack?: MediaStreamTrack;
  /** The capture before the gain — what the level meter listens to. */
  sourceTrack?: MediaStreamTrack;
  gain: number;
  private audioContext?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private gainNode?: GainNode;

  constructor(gain: number) {
    this.gain = gain;
  }

  async init({ track, audioContext }: AudioProcessorOptions) {
    this.audioContext = audioContext;
    this.connect(track);
  }

  // LiveKit calls this on every restartTrack (device switch, input profile)
  // without an audioContext, so the one from init is reused.
  async restart({ track }: AudioProcessorOptions) {
    this.disconnect();
    this.connect(track);
  }

  async destroy() {
    this.disconnect();
  }

  setGain(gain: number) {
    this.gain = gain;
    if (this.gainNode) this.gainNode.gain.value = gain;
  }

  private connect(track: MediaStreamTrack) {
    const ctx = this.audioContext!;
    this.sourceTrack = track;
    this.source = ctx.createMediaStreamSource(new MediaStream([track]));
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = this.gain;
    const destination = ctx.createMediaStreamDestination();
    this.source.connect(this.gainNode).connect(destination);
    this.processedTrack = destination.stream.getAudioTracks()[0];
  }

  private disconnect() {
    this.source?.disconnect();
    this.gainNode?.disconnect();
    this.processedTrack?.stop();
    this.source = undefined;
    this.gainNode = undefined;
    this.processedTrack = undefined;
    this.sourceTrack = undefined;
  }
}

export function inputGainProcessorOf(track: LocalAudioTrack): InputGainProcessor | undefined {
  const processor = track.getProcessor();
  return processor instanceof InputGainProcessor ? processor : undefined;
}

let sharedContext: AudioContext | null = null;
const installing = new WeakMap<LocalAudioTrack, Promise<void>>();

export async function applyInputGain(track: LocalAudioTrack, gain: number): Promise<void> {
  await installing.get(track);
  const existing = inputGainProcessorOf(track);
  if (existing) {
    existing.setGain(gain);
    return;
  }
  // Full volume needs no processing: the raw capture stays published as is.
  if (gain >= 1) return;

  const install = (async () => {
    const ctx = (sharedContext ??= new AudioContext());
    // resume() only settles after a user gesture, and a suspended context
    // would publish silence — better to keep sending the mic at full volume.
    await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 300))]);
    if (ctx.state !== 'running') return;
    track.setAudioContext(ctx);
    await track.setProcessor(new InputGainProcessor(gain));
  })();
  installing.set(track, install);
  try {
    await install;
  } finally {
    installing.delete(track);
  }
}
