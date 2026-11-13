import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DURATION } from '@/shared/lib/ease';
import { placeholderDataUrl } from '@/shared/lib/placeholderImage';
import { cn } from '@/shared/lib/utils';

interface PreviewImageProps {
  /** unset while the address is not known yet: the box is drawn already */
  src: string | undefined;
  /** the server's ThumbHash of the picture, painted until it loads */
  placeholder?: string | null;
  alt?: string;
  /** the picture's own classes (fit, rounding) */
  className?: string;
  /** the box both layers share; fills its parent by default */
  frameClassName?: string;
  onError?: () => void;
}

/** A link preview's picture over its blurred placeholder: the picture fades in
 * over it (DURATION.settle), then the placeholder goes, since left behind it
 * would show through a transparent PNG. A picture the browser already has
 * shows at once, and reduced motion drops the fade (motion-reduce). */
export function PreviewImage({ src, placeholder, alt = '', className, frameClassName = 'size-full', onError }: PreviewImageProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [instant, setInstant] = useState(false);
  const [placeholderGone, setPlaceholderGone] = useState(false);
  const background = placeholderGone ? null : placeholderDataUrl(placeholder ?? undefined);

  // a new address (the still frame of a GIF swapped for the moving one) is a
  // new load; one already cached is complete before the first paint
  useLayoutEffect(() => {
    const image = imageRef.current;
    const cached = !!image && image.complete && image.naturalWidth > 0;
    setLoaded(cached);
    setInstant(cached);
  }, [src]);

  useEffect(() => {
    if (!loaded || placeholderGone) return;
    const timer = window.setTimeout(() => setPlaceholderGone(true), instant ? 0 : DURATION.settle);
    return () => window.clearTimeout(timer);
  }, [loaded, instant, placeholderGone]);

  return (
    <span className={cn('relative block', frameClassName)}>
      {background && <img src={background} alt="" aria-hidden data-preview-placeholder="" className="absolute inset-0 size-full object-cover" />}
      <img
        ref={imageRef}
        src={src}
        // empty until loaded: no alt text or broken-image icon over the placeholder
        alt={loaded ? alt : ''}
        onLoad={() => setLoaded(true)}
        onError={onError}
        className={cn(
          'relative',
          !instant && 'transition-opacity duration-200 ease-out-expo motion-reduce:transition-none',
          loaded || !background ? 'opacity-100' : 'opacity-0',
          className,
        )}
      />
    </span>
  );
}
