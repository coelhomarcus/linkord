import { useState } from 'react';
import { placeholderDataUrl } from '@/shared/lib/placeholderImage';

interface PreviewImageProps {
  /** unset while the address is not known yet: the box is drawn already */
  src: string | undefined;
  /** the server's ThumbHash of the picture, painted until it loads */
  placeholder?: string | null;
  className?: string;
  onError?: () => void;
}

/** A link preview's picture over its blurred placeholder. The placeholder
 * goes once the picture is there: left behind, it would show through a
 * transparent PNG. */
export function PreviewImage({ src, placeholder, className, onError }: PreviewImageProps) {
  const [loaded, setLoaded] = useState(false);
  const background = loaded ? null : placeholderDataUrl(placeholder ?? undefined);
  return (
    <img
      src={src}
      alt=""
      onLoad={() => setLoaded(true)}
      onError={onError}
      style={background ? { backgroundImage: `url(${background})`, backgroundSize: 'cover' } : undefined}
      className={className}
    />
  );
}
