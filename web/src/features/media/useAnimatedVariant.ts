import type { RefObject } from 'react';
import { proxiedImageVariant } from '@/shared/lib/mediaProxy';
import { useInView } from './useInView';

/** A proxied picture at the width it is drawn. One the server found to be
 * animated (`imageAnimated`) moves only while in view: out of it, the address
 * is the still first frame at the same width (the media proxy's
 * `animated=false`), so the box never changes and nothing decodes off screen. */
export function useAnimatedVariant(ref: RefObject<HTMLElement | null>, src: string | null, width: number, animated: boolean | undefined): string | null {
  const inView = useInView(ref, !!src && !!animated);
  if (!src) return null;
  return proxiedImageVariant(src, { width, animated: !animated || inView });
}
