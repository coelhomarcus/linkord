import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useState } from 'react';
import { CloseButton } from '@/shared/ui/primitives/close-button';

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: 'default' | 'profile';
  aspectRatio?: number;
}

export function ImageLightbox({ src: srcProp, alt: altProp, open, onOpenChange, variant = 'default', aspectRatio: aspectRatioProp = 1 }: ImageLightboxProps) {
  // Callers clear src (and reset the ratio) the moment they close it, but the
  // popup is still fading out: without the last image kept here it would
  // flash a broken image with its alt text before it disappears.
  const [last, setLast] = useState({ src: srcProp, alt: altProp, aspectRatio: aspectRatioProp });
  if (srcProp && (last.src !== srcProp || last.alt !== altProp || last.aspectRatio !== aspectRatioProp)) {
    setLast({ src: srcProp, alt: altProp, aspectRatio: aspectRatioProp });
  }
  const { src, alt, aspectRatio } = srcProp ? { src: srcProp, alt: altProp, aspectRatio: aspectRatioProp } : last;

  const isProfile = variant === 'profile';
  const profileFrameStyle = isProfile ? {
    width: '80vw',
    maxWidth: `${80 * aspectRatio}vh`,
    aspectRatio,
  } : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="image-lightbox-backdrop"
          className="fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          data-slot="image-lightbox-popup"
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center p-8 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
          onClick={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">{alt || 'Imagem'}</DialogPrimitive.Title>
          {isProfile ? (
            <div
              data-slot="image-lightbox-frame"
              style={profileFrameStyle}
              className="flex items-center justify-center overflow-hidden rounded-md border border-white/20 bg-black/15 shadow-popover"
            >
              <img
                src={src}
                alt={alt}
                data-download-url={src}
                data-download-name={alt || 'imagem'}
                className="h-full w-full cursor-default object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : (
            <img
              src={src}
              alt={alt}
              data-download-url={src}
              data-download-name={alt || 'imagem'}
              className="max-h-full max-w-full cursor-default rounded-md border border-white/20 object-contain shadow-popover"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <DialogPrimitive.Close render={<CloseButton variant="overlay" size="md" className="fixed right-4 top-4 z-50" />} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
