import { useCallback, useMemo, useRef } from 'react';
import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react';
import { useReducedMotion } from 'motion/react';

// The icons in this folder come from lucide-animated.com (shadcn registry),
// adapted to this repo: `cn` import path, a <span> root so they are valid
// inside a <button>, and inline-flex so they sit centred like lucide's.
export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export type AnimatedIcon = ForwardRefExoticComponent<
  HTMLAttributes<HTMLSpanElement> & { size?: number } & RefAttributes<AnimatedIconHandle>
>;

/** Each icon only animates while the pointer is over the icon itself, which
 * in a 44px button is a 20px target. Spreading `triggerProps` on the button
 * hands the animation to the whole control (hover and keyboard focus);
 * passing the ref switches the icon's own hover handling off. Nothing plays
 * when the system asks for reduced motion. */
export function useAnimatedIcon<T extends AnimatedIconHandle = AnimatedIconHandle>() {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();
  const start = useCallback(() => { if (!reduce) ref.current?.startAnimation(); }, [reduce]);
  const stop = useCallback(() => { ref.current?.stopAnimation(); }, []);
  const triggerProps = useMemo(
    () => ({ onPointerEnter: start, onPointerLeave: stop, onFocus: start, onBlur: stop }),
    [start, stop]
  );
  return { ref, triggerProps };
}
