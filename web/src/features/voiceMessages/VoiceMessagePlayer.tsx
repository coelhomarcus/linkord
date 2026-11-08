import { PauseIcon, PlayIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { getMediaVolumeState, subscribeMediaVolume } from '@/shared/lib/mediaVolume';
import { cn } from '@/shared/lib/utils';
import { decodeWaveform, formatVoiceDuration } from './voiceFormat';

const SPEEDS = [1, 1.5, 2] as const;
const SEEK_STEP_S = 5;

// One voice message plays at a time, like any chat app: starting one pauses
// whichever was playing.
let playingElement: HTMLAudioElement | null = null;

interface VoiceMessagePlayerProps {
  /** null while the file only exists on this device (still uploading) */
  src: string | null;
  durationMs: number;
  waveform: string;
  /** file name, for the context menu's download */
  name?: string;
  className?: string;
}

export function VoiceMessagePlayer({ src, durationMs, waveform, name, className }: VoiceMessagePlayerProps) {
  const { t } = useTranslation('voiceMessages');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentS, setCurrentS] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const bars = useMemo(() => decodeWaveform(waveform), [waveform]);
  // the recorder's duration, not the element's: MediaRecorder files often
  // report Infinity until they have been played through once
  const durationS = durationMs / 1000;
  const progress = durationS > 0 ? Math.min(1, currentS / durationS) : 0;
  const started = playing || currentS > 0;

  useEffect(() => {
    const apply = () => { if (audioRef.current) audioRef.current.volume = getMediaVolumeState().volume; };
    apply();
    return subscribeMediaVolume(apply);
  }, []);

  useEffect(() => () => {
    if (playingElement === audioRef.current) playingElement = null;
  }, []);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (!audio.paused) { audio.pause(); return; }
    if (playingElement && playingElement !== audio) playingElement.pause();
    playingElement = audio;
    audio.playbackRate = SPEEDS[speedIndex]!;
    setFailed(false);
    await audio.play().catch(() => {});
  }

  function seekTo(seconds: number) {
    const audio = audioRef.current;
    const next = Math.min(durationS, Math.max(0, seconds));
    setCurrentS(next);
    if (audio && src) audio.currentTime = next;
  }

  function seekFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekTo(((event.clientX - rect.left) / rect.width) * durationS);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowRight: SEEK_STEP_S, ArrowUp: SEEK_STEP_S, ArrowLeft: -SEEK_STEP_S, ArrowDown: -SEEK_STEP_S };
    if (event.key in moves) { event.preventDefault(); seekTo(currentS + moves[event.key]!); return; }
    if (event.key === 'Home') { event.preventDefault(); seekTo(0); return; }
    if (event.key === 'End') { event.preventDefault(); seekTo(durationS); }
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]!;
  }

  const timeLabel = formatVoiceDuration((started ? currentS : durationS) * 1000);

  return (
    <div
      role="group"
      aria-label={t('player.label', { duration: formatVoiceDuration(durationMs) })}
      className={cn('flex w-80 min-w-0 max-w-full items-center gap-2.5 rounded-lg border border-border-default bg-bg-tertiary px-2.5 py-2', className)}
      data-download-url={src ?? undefined}
      data-download-name={src ? name : undefined}
    >
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrentS(event.currentTarget.currentTime)}
          onEnded={(event) => { setPlaying(false); setCurrentS(0); event.currentTarget.currentTime = 0; }}
          onError={() => { setPlaying(false); setFailed(true); }}
        />
      )}
      <button
        type="button"
        aria-label={playing ? t('player.pause') : t('player.play')}
        disabled={!src}
        onClick={() => void togglePlay()}
        className="flex size-9 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {playing ? <PauseIcon size={16} weight="fill" /> : <PlayIcon size={16} weight="fill" className="ml-0.5" />}
      </button>

      <div
        role="slider"
        tabIndex={src ? 0 : -1}
        aria-label={t('player.position')}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationS)}
        aria-valuenow={Math.round(currentS)}
        aria-valuetext={t('player.positionValue', { current: formatVoiceDuration(currentS * 1000), total: formatVoiceDuration(durationMs) })}
        aria-disabled={!src || undefined}
        onPointerDown={(event) => {
          if (!src) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          seekFromPointer(event);
        }}
        onPointerMove={(event) => { if (src && event.buttons === 1) seekFromPointer(event); }}
        onKeyDown={src ? handleKeyDown : undefined}
        className={cn('flex h-8 min-w-0 flex-1 touch-none items-center gap-px overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50', src && 'cursor-pointer')}
      >
        {bars.map((value, i) => (
          <span
            key={i}
            aria-hidden
            style={{ height: `${Math.max(12, value * 100)}%` }}
            className={cn('min-w-px flex-1 rounded-full transition-colors', (i + 0.5) / bars.length <= progress ? 'bg-primary' : 'bg-text-faint/50')}
          />
        ))}
      </div>

      <span className="w-9 flex-none select-none text-right text-caption tabular-nums text-text-muted">{timeLabel}</span>
      {failed ? (
        <WarningCircleIcon size={18} className="flex-none text-red" aria-label={t('player.failed')} role="img" />
      ) : (
        <button
          type="button"
          onClick={cycleSpeed}
          disabled={!src}
          aria-label={t('player.speed', { speed: SPEEDS[speedIndex] })}
          className="w-9 flex-none rounded-md px-1 py-0.5 text-caption font-semibold tabular-nums text-text-secondary hover:bg-fill-hover disabled:opacity-50"
        >
          {SPEEDS[speedIndex]}×
        </button>
      )}
    </div>
  );
}
