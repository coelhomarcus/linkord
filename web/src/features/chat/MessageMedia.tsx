import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatAttachment as ChatAttachmentData } from '@/shared/types/protocol';
import { useCachedImageSrc } from '@/shared/hooks/useCachedImageSrc';
import { cn } from '@/shared/lib/utils';
import { ChatAttachment } from './ChatAttachment';
import { placeholderDataUrl } from './placeholderImage';
import { MEDIA_MAX_WIDTH, mosaicLayout, singleImageBox, splitAttachments } from './mediaLayout';
import { MediaViewerProvider } from './MediaViewerProvider';
import { useMediaViewer } from './useMediaViewer';

// the old natural-size rule capped height at max-h-80
const LEGACY_IMAGE_BOX_HEIGHT = 320;

function MediaImage({ attachment, className, onNaturalSize }: { attachment: ChatAttachmentData; className?: string; onNaturalSize?: (size: { width: number; height: number }) => void }) {
  // Left unset (not the raw url) while the cache warms — see
  // useCachedImageSrc: a fallback src would fire a second request.
  const src = useCachedImageSrc(`/uploads/${attachment.thumbId ?? attachment.id}`);
  const [loaded, setLoaded] = useState(false);
  const placeholder = loaded ? null : placeholderDataUrl(attachment.placeholder);
  // The blurred placeholder fills the box until the picture is there, then
  // goes: left behind, it would show through a transparent PNG.
  return (
    <img
      src={src ?? undefined}
      // empty until loaded: with no pixels yet, alt text and the broken-image
      // icon would be drawn over the placeholder (the button carries the name)
      alt={loaded ? attachment.name : ''}
      loading="lazy"
      onLoad={(event) => {
        setLoaded(true);
        const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
        if (width > 0 && height > 0) onNaturalSize?.({ width, height });
      }}
      style={placeholder ? { backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' } : undefined}
      className={className}
    />
  );
}

/** An image stored before dimensions existed: its size is unknown, so a box of
 * fixed height holds it while it loads, then takes the picture's own
 * proportions once the browser reports them (no bars around an odd shape). */
function LegacyImageButton({ attachment, onOpen, className }: { attachment: ChatAttachmentData; onOpen: () => void; className: string }) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const box = natural ? singleImageBox(natural) : null;
  return (
    <button
      type="button"
      aria-label={`Abrir ${attachment.name}`}
      onClick={onOpen}
      className={className}
      style={box ? { width: box.width, aspectRatio: box.aspectRatio } : { width: `min(100%, ${MEDIA_MAX_WIDTH}px)`, height: LEGACY_IMAGE_BOX_HEIGHT }}
    >
      <MediaImage attachment={attachment} onNaturalSize={setNatural} className={cn('block size-full', box ? 'object-cover' : 'object-contain')} />
    </button>
  );
}

/** The pictures of a message as one unit (a lone image at its own shape, or
 * a 2–4 mosaic), followed by its other files. Every box is sized before the
 * pixels arrive, so loading doesn't move the history. */
export function MessageMedia({ attachments }: { attachments: ChatAttachmentData[] }) {
  const viewer = useMediaViewer();
  if (!viewer) return <MediaViewerProvider><MessageMedia attachments={attachments} /></MediaViewerProvider>;
  // data-attachment-id names which one a right-click is on (GlobalContextMenu
  // offers taking it out); `contents` keeps the child's own box and widths
  const tagged = (attachment: ChatAttachmentData, node: ReactNode) => (
    <div key={attachment.id} data-attachment-id={attachment.id} className="contents">{node}</div>
  );

  const { visual, files } = splitAttachments(attachments);
  const openAt = (index: number) => viewer.open(visual.map((a) => ({ src: `/uploads/${a.id}`, name: a.name })), index);
  const cellButton = 'block cursor-zoom-in overflow-hidden bg-fill-subtle focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/60';

  let pictures = null;
  if (visual.length === 1) {
    const attachment = visual[0]!;
    const box = singleImageBox(attachment);
    pictures = tagged(attachment, box ? (
      <button type="button" aria-label={`Abrir ${attachment.name}`} onClick={() => openAt(0)} style={{ width: box.width, aspectRatio: box.aspectRatio }} className={cn(cellButton, 'rounded-lg')}>
        <MediaImage attachment={attachment} className="block size-full object-cover" />
      </button>
    ) : (
      <LegacyImageButton attachment={attachment} onOpen={() => openAt(0)} className={cn(cellButton, 'rounded-lg')} />
    ));
  } else if (visual.length > 1) {
    const layout = mosaicLayout(visual.length);
    pictures = (
      <div
        className="grid gap-0.5 overflow-hidden rounded-lg"
        style={{ width: `min(100%, ${MEDIA_MAX_WIDTH}px)`, aspectRatio: layout.aspectRatio, gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows }}
      >
        {visual.map((attachment, index) => (
          // the cell is the grid item: its corner is the picture's corner
          <div key={attachment.id} data-attachment-id={attachment.id} style={{ gridArea: layout.areas[index] }} className="relative min-h-0 min-w-0">
            <button
              type="button"
              aria-label={`Abrir ${attachment.name} (${index + 1} de ${visual.length})`}
              onClick={() => openAt(index)}
              className={cn(cellButton, 'size-full')}
            >
              <MediaImage attachment={attachment} className="block size-full object-cover" />
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {pictures}
      {files.map((attachment) => tagged(attachment, <ChatAttachment attachment={attachment} />))}
    </div>
  );
}
