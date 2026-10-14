import { useEffect, useRef } from 'react';
import type { ComponentType, ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react';
import { useReducedMotion } from 'motion/react';

// The icons in this folder come from lucide-animated.com (shadcn registry),
// adapted to this repo: `cn` import path, a <span> root so they are valid
// inside a <button>, inline-flex so they sit centred like lucide's, and a
// string `size` ("100%") for when a class sizes the icon instead.
// A path that animates its `d` (the arrows) also needs `initial="normal"`:
// without it motion has no starting value of its own for `d`, and the first
// animation of an icon mounted inside an entering AnimatePresence child
// writes d="undefined".
export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export type IconProps = HTMLAttributes<HTMLSpanElement> & { size?: number | string };

type VendoredIcon = ForwardRefExoticComponent<IconProps & RefAttributes<AnimatedIconHandle>>;

const CONTROL = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"]';

/** A vendored icon on its own animates only while the pointer is over the
 * glyph itself (20px inside a 44px button). Bound, it animates with the
 * nearest control around it instead, on hover and on keyboard focus; an icon
 * outside any control stays still, and so does everything under
 * prefers-reduced-motion. A status icon that sits inside a larger control
 * (a row, a video tile) should stay on lucide-react, or it would animate
 * whenever that whole control is hovered. */
export function bindToControl(Icon: VendoredIcon, displayName: string) {
  function BoundIcon({ size = 24, ...props }: IconProps) {
    const hostRef = useRef<HTMLSpanElement>(null);
    const iconRef = useRef<AnimatedIconHandle>(null);
    const reduce = useReducedMotion();

    useEffect(() => {
      const control = hostRef.current?.closest(CONTROL);
      if (!control || reduce) return;
      const start = () => iconRef.current?.startAnimation();
      const stop = () => iconRef.current?.stopAnimation();
      control.addEventListener('pointerenter', start);
      control.addEventListener('pointerleave', stop);
      control.addEventListener('focusin', start);
      control.addEventListener('focusout', stop);
      return () => {
        control.removeEventListener('pointerenter', start);
        control.removeEventListener('pointerleave', stop);
        control.removeEventListener('focusin', start);
        control.removeEventListener('focusout', stop);
      };
    }, [reduce]);

    return (
      <span ref={hostRef} className="contents">
        <Icon ref={iconRef} size={size} aria-hidden {...props} />
      </span>
    );
  }
  BoundIcon.displayName = displayName;
  return BoundIcon;
}

export type BoundIcon = ReturnType<typeof bindToControl>;

/** What a catalog entry's icon may be: a lucide-react icon or one of these. */
export type IconComponent = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
