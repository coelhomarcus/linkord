import { useEffect, useState } from 'react';
import { LocalAudioTrack, TrackEvent } from 'livekit-client';
import type { Track } from 'livekit-client';
import { inputGainProcessorOf } from './inputGain';

/** 0..1 level of the call's own microphone, read only while mounted (the
 * quick menu). Unlike Settings' mic test it opens no new capture: it clones
 * the published track, and the clone is enabled on its own so the meter
 * still answers "is it picking me up?" while muted. */
export function useMicInputLevel(track: Track | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!(track instanceof LocalAudioTrack)) return;
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    let stop = () => {};
    const start = () => {
      stop();
      const raw = inputGainProcessorOf(track)?.sourceTrack ?? track.mediaStreamTrack;
      if (!raw || raw.readyState === 'ended') return;
      const probe = raw.clone();
      probe.enabled = true;
      const ctx = new AudioContextCtor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([probe])).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let frame = requestAnimationFrame(function tick() {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sumSquares += centered * centered;
        }
        // Read every frame: the gain processor may be installed after the
        // meter started, and the meter should follow "Volume de entrada".
        const gain = inputGainProcessorOf(track)?.gain ?? 1;
        setLevel(Math.min(1, Math.sqrt(sumSquares / data.length) * 4 * gain));
        frame = requestAnimationFrame(tick);
      });
      stop = () => {
        cancelAnimationFrame(frame);
        probe.stop();
        ctx.close().catch(() => {});
        setLevel(0);
      };
    };

    start();
    track.on(TrackEvent.Restarted, start);
    return () => {
      track.off(TrackEvent.Restarted, start);
      stop();
    };
  }, [track]);

  return level;
}
