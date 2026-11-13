import { useTranslation } from 'react-i18next';
import { mosaicLayout } from '@/features/chat/mediaLayout';
import { proxiedImageVariant } from '@/shared/lib/mediaProxy';

// the mosaic shows at most this many; the last cell counts the rest
const MAX_CELLS = 4;

/** A page's several pictures as the chat lays out several attachments: a
 * fixed-ratio mosaic, cells cropped, the order the page gave. A cell opens
 * all of them in the viewer, at that one. */
export function EmbedGallery({ images, width, onOpen }: { images: string[]; width: number; onOpen: (index: number) => void }) {
  const { t } = useTranslation('media');
  const shown = images.slice(0, MAX_CELLS);
  const hidden = images.length - shown.length;
  const layout = mosaicLayout(shown.length);
  return (
    <div
      className="grid w-full gap-0.5"
      style={{ aspectRatio: layout.aspectRatio, gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows }}
    >
      {shown.map((src, index) => {
        const more = index === shown.length - 1 && hidden > 0;
        return (
          <button
            key={src}
            type="button"
            onClick={() => onOpen(index)}
            aria-label={more ? t('embed.galleryMore', { count: hidden }) : t('embed.galleryImage', { index: index + 1, count: images.length })}
            style={{ gridArea: layout.areas[index] }}
            className="relative min-h-0 min-w-0 cursor-zoom-in overflow-hidden bg-fill-subtle outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            {/* the first cell spans the height of a three-cell mosaic: asked for wide enough for either */}
            <img src={proxiedImageVariant(src, { width: index === 0 ? width : width / 2 })} alt="" loading="lazy" className="size-full object-cover" />
            {more && (
              <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/55 text-title font-semibold text-white">
                +{hidden}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
