import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { cn } from '@/shared/lib/utils';

// the button's inset from the child's top-right corner, and its own size (xs)
const INSET = 6;
const SIZE = 24;

/** Puts a remove button on the top-right corner of its only child (a link
 * card, a picture, a file). The child keeps its own width: wrapping it in a
 * box that shrinks to fit would change how its percentage widths resolve,
 * so the button is placed from the child's measured box instead. Shown on
 * hover, and always on a touch screen, which has none. */
export function RemoveCorner({ label, onRemove, className, style, children }: {
  label: string;
  onRemove: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [corner, setCorner] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const child = ref.current?.firstElementChild as HTMLElement | null;
    if (!child) return;
    const place = () => setCorner({ top: child.offsetTop + INSET, left: child.offsetLeft + child.offsetWidth - INSET - SIZE });
    place();
    const observer = new ResizeObserver(place);
    observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn('group/remove relative', className)} style={style}>
      {children}
      {corner && (
        <CloseButton
          variant="overlay"
          size="xs"
          label={label}
          onClick={onRemove}
          style={corner}
          className="absolute z-10 opacity-0 transition-opacity group-hover/remove:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        />
      )}
    </div>
  );
}
