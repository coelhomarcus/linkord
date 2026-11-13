import { useCallback, useEffect, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent } from 'react';

/** How long a playing video's controls stay after the last pointer move,
 * touch or key: inline, and in the expanded view, where they cover more. */
export const CONTROLS_IDLE_MS = { inline: 3_000, expanded: 1_000 } as const;

interface Options {
  playing: boolean;
  idleMs: number;
  /** something the controls opened (the speed menu) keeps them up */
  pinned?: boolean;
}

/** Whether a video's controls show. They stay while paused, while one of them
 * has focus or is pinned open; otherwise they hide after `idleMs` without
 * activity (starting playback is itself a click or a key, so it counts).
 * Hidden controls still take focus (not inert), and focusing one brings them
 * back, so a keyboard never lands on something invisible. */
export function useControlsVisibility({ playing, idleMs, pinned = false }: Options) {
  const [active, setActive] = useState(true);
  const [controlFocused, setControlFocused] = useState(false);
  const timer = useRef(0);

  const reveal = useCallback(() => {
    setActive(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setActive(false), idleMs);
  }, [idleMs]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const visible = !playing || pinned || controlFocused || active;

  const bind = {
    onPointerMove: (event: PointerEvent) => {
      // a touch drag (a scroll) passing over the video is not interest in it
      if (event.pointerType !== 'touch') reveal();
    },
    onPointerDown: reveal,
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      window.clearTimeout(timer.current);
      setActive(false);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      // the player itself takes focus on a click; only its controls hold them up
      if (event.target !== event.currentTarget) setControlFocused(true);
      reveal();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !event.currentTarget.contains(next) || next === event.currentTarget) setControlFocused(false);
    },
  };

  return { visible, reveal, bind };
}
