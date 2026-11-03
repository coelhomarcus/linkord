import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

export interface TrimRange {
  start: number;
  end: number;
}

interface WaveformProps {
  peaks: number[];
  /** seconds */
  duration: number;
  /** when set, the edges become draggable and the rest of the clip dims */
  trim?: TrimRange;
  onTrimChange?: (trim: TrimRange) => void;
  maxTrim?: number;
  /** 0..1 across the trimmed range (or the whole clip), null when stopped */
  playhead: number | null;
}

const MIN_TRIM = 0.1;
const KEY_STEP = 0.05;

type DragKind = 'start' | 'end' | 'region';

/** Bars of the clip's peaks; with `trim`, two handles pick the part to keep
 * (never longer than `maxTrim`) and dragging between them slides the window. */
export function Waveform({ peaks, duration, trim, onTrimChange, maxTrim = Infinity, playhead }: WaveformProps) {
  const { t } = useTranslation('soundboard');
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ kind: DragKind; grabOffset: number } | null>(null);

  const range = trim ?? { start: 0, end: duration };
  const pct = (sec: number) => (duration > 0 ? (sec / duration) * 100 : 0);

  function clampTrim(kind: DragKind, at: number, current: TrimRange): TrimRange {
    const span = current.end - current.start;
    if (kind === 'region') {
      const start = Math.max(0, Math.min(duration - span, at));
      return { start, end: start + span };
    }
    if (kind === 'start') {
      const start = Math.max(0, current.end - maxTrim, Math.min(at, current.end - MIN_TRIM));
      return { start, end: current.end };
    }
    const end = Math.min(duration, current.start + maxTrim, Math.max(at, current.start + MIN_TRIM));
    return { start: current.start, end };
  }

  function secondsAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  }

  function onPointerDown(kind: DragKind) {
    return (event: PointerEvent<HTMLElement>) => {
      if (!trim || !onTrimChange) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { kind, grabOffset: kind === 'region' ? secondsAt(event.clientX) - trim.start : 0 };
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || !trim || !onTrimChange) return;
    onTrimChange(clampTrim(drag.kind, secondsAt(event.clientX) - drag.grabOffset, trim));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onHandleKey(kind: 'start' | 'end') {
    return (event: KeyboardEvent<HTMLElement>) => {
      if (!trim || !onTrimChange) return;
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -KEY_STEP : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? KEY_STEP : 0;
      if (!delta) return;
      event.preventDefault();
      onTrimChange(clampTrim(kind, (kind === 'start' ? trim.start : trim.end) + delta, trim));
    };
  }

  const playheadAt = playhead === null ? null : range.start + playhead * (range.end - range.start);

  return (
    <div ref={trackRef} className="relative h-24 w-full min-w-0 select-none touch-none">
      <div className="absolute inset-0 flex items-center gap-px">
        {peaks.map((peak, i) => {
          const at = ((i + 0.5) / peaks.length) * duration;
          const inside = at >= range.start && at <= range.end;
          return (
            <span
              key={i}
              aria-hidden
              className={cn('min-w-px flex-1 rounded-full transition-colors', inside ? 'bg-white/90' : 'bg-white/25')}
              style={{ height: `${Math.max(4, peak * 100)}%` }}
            />
          );
        })}
      </div>

      {trim && onTrimChange && (
        <>
          <div
            aria-hidden
            onPointerDown={onPointerDown('region')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="absolute inset-y-0 cursor-grab active:cursor-grabbing"
            style={{ left: `${pct(trim.start)}%`, width: `${pct(trim.end - trim.start)}%` }}
          />
          {(['start', 'end'] as const).map((kind) => (
            <div
              key={kind}
              role="slider"
              tabIndex={0}
              aria-label={kind === 'start' ? t('editor.trimStart') : t('editor.trimEnd')}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 100) / 100}
              aria-valuenow={Math.round(trim[kind] * 100) / 100}
              aria-valuetext={`${trim[kind].toFixed(2)}s`}
              onPointerDown={onPointerDown(kind)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={onHandleKey(kind)}
              className="absolute inset-y-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize justify-center outline-none focus-visible:[&>span]:ring-3 focus-visible:[&>span]:ring-accent/60"
              style={{ left: `${pct(trim[kind])}%` }}
            >
              <span className="relative h-full w-0.5 rounded-full bg-white">
                <span className="absolute top-1/2 left-1/2 h-6 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white" />
              </span>
            </div>
          ))}
        </>
      )}

      {playheadAt !== null && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${pct(playheadAt)}%` }} />
      )}
    </div>
  );
}
