import { useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';

import { formatMediaTime } from './mediaTime';

const PREVIEW_WIDTH = 160;

interface SeekPreviewProps {
  src: string;
  duration: number;
  /** width / height of the video, so the frame keeps its shape */
  aspectRatio: number;
  /** the timeline it sits over */
  children: ReactNode;
}

/** A frame of the video above the timeline where a mouse hovers it, from a
 * second muted copy of the video that only seeks. It is created on the first
 * hover (no second download for someone who never points at the bar), only
 * for a mouse or pen, and is hidden from assistive tech: the timeline's own
 * value text already says where it is. */
export function SeekPreview({ src, duration, aspectRatio, children }: SeekPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hover, setHover] = useState<{ time: number; x: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  // the time to show once the seek in flight lands: seeks never queue up
  const pending = useRef<number | null>(null);
  const seeking = useRef(false);

  function seekPreview(time: number) {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
      pending.current = time;
      return;
    }
    if (seeking.current) {
      pending.current = time;
      return;
    }
    seeking.current = true;
    video.currentTime = time;
  }

  // after a seek lands, and once the metadata a seek waits for has arrived
  function flushPending() {
    seeking.current = false;
    const next = pending.current;
    pending.current = null;
    if (next !== null) seekPreview(next);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // a player narrower than the frame has no room to show it
    if (rect.width < PREVIEW_WIDTH) return;
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const time = (x / rect.width) * duration;
    setMounted(true);
    setHover({ time, x, width: rect.width });
    seekPreview(time);
  }

  const height = Math.round(PREVIEW_WIDTH / (aspectRatio > 0 ? aspectRatio : 16 / 9));
  const left = hover ? Math.min(Math.max(0, hover.width - PREVIEW_WIDTH), Math.max(0, hover.x - PREVIEW_WIDTH / 2)) : 0;

  return (
    <div className="relative" data-seek-area="" onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}>
      {mounted && (
        <div
          aria-hidden
          data-seek-preview=""
          className={hover ? 'pointer-events-none absolute bottom-full z-10 mb-2 flex flex-col items-center gap-1' : 'hidden'}
          style={{ left, width: PREVIEW_WIDTH }}
        >
          <div className="overflow-hidden rounded-md border border-white/20 bg-black shadow-popover" style={{ width: PREVIEW_WIDTH, height }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} src={src} muted playsInline preload="metadata" tabIndex={-1} onSeeked={flushPending} onLoadedMetadata={flushPending} className="block size-full object-contain" />
          </div>
          {hover && (
            <span className="rounded-sm bg-black/80 px-1.5 py-0.5 text-caption tabular-nums text-white">{formatMediaTime(hover.time)}</span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
