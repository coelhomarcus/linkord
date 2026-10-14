import { useEffect, useRef, useState } from 'react';
import type { RefObject, SyntheticEvent } from 'react';
import { ImageOff } from 'lucide-react';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { ImageLightbox } from './ImageLightbox';
import { GenericEmbed } from './GenericEmbed';
import { AudioPlayer, VideoPlayer } from './MediaPlayers';
import { availableAttachmentWidth, useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';
import { getCachedLinkPreview, loadLinkPreview } from '@/shared/lib/linkPreviewCache';
import type { LinkPreviewData } from '@/shared/api/api';
import { embedImageBox, previewImageSize, type ImageSize } from './embedImageBox';
import { useNearViewport } from './useNearViewport';

/** The server's measurement of a picture behind an arbitrary URL, asked for
 * shortly before it scrolls into view. Until it answers (or if it can't
 * tell), the box keeps its fixed fallback size. */
function useRemoteImageSize(url: string, ref: RefObject<HTMLElement | null>, enabled: boolean, stored: LinkPreviewData | undefined): ImageSize | null {
  const near = useNearViewport(ref);
  const [size, setSize] = useState<ImageSize | null>(() => (enabled ? previewImageSize(getCachedLinkPreview(url)) : null));
  useEffect(() => {
    // the size came with the message: nothing to ask
    if (!enabled || !near || stored) return;
    let cancelled = false;
    loadLinkPreview(url)
      .then((data) => { if (!cancelled) setSize(previewImageSize(data)); })
      .catch(() => { /* no size: the fallback box stays */ });
    return () => { cancelled = true; };
  }, [url, near, enabled, stored]);
  return (enabled && previewImageSize(stored)) || size;
}

function EmbedFailedFallback({ url, className }: { url: string; className: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-full max-w-sm items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2.5 text-label text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
    >
      <ImageOff size={14} className="flex-none" />
      <span className="truncate">Não foi possível carregar a prévia. Abrir link</span>
    </a>
  );
}

interface LinkPreviewProps {
  embed: DetectedEmbed;
  className?: string;
  /** True when this is the message's only content — drops the outer
   * border/rounding so the preview fills the bubble instead of sitting in
   * a second frame nested inside it. */
  edgeToEdge?: boolean;
  /** True when this card's immediate parent already has a definite,
   * non-content-dependent width (e.g. a masonry grid column, which sets an
   * explicit pixel width on each item) — lets the bare-image case below
   * just fill it (`w-full`) instead of using the JS-computed chat-row
   * width cap. That cap exists because a chat message's real parent is a
   * flex item that hugs its own content (see chatSurfaceWidth.tsx), where
   * a CSS percentage can't resolve correctly — that reasoning doesn't
   * apply once the parent already has a real width, so forcing the same
   * fixed px cap there instead only made the image wider than its column,
   * overlapping the next one. */
  fitContainer?: boolean;
  /** the preview the server stored with the message, when there is one: the
   * card is drawn from it at once instead of fetched */
  preview?: LinkPreviewData;
}

export function LinkPreview({ embed, className = '', edgeToEdge, fitContainer, preview }: LinkPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const surfaceWidth = useChatSurfaceWidth(384 + 120);
  const maxWidth = availableAttachmentWidth(surfaceWidth, 384);
  const boxRef = useRef<HTMLButtonElement | null>(null);
  const remoteSize = useRemoteImageSize(embed.url, boxRef, embed.kind === 'image' && !fitContainer, preview);
  // When the server could not measure it, the picture itself reports its size
  // as it loads, and the box is fitted to that: no bars around an odd shape.
  const [loadedSize, setLoadedSize] = useState<ImageSize | null>(null);
  const knownSize = remoteSize ?? loadedSize;

  if (embed.kind === 'youtube' || embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip' || embed.kind === 'link') {
    return <GenericEmbed key={embed.url} embed={embed} className={className} edgeToEdge={edgeToEdge} preview={preview} />;
  }

  if (failed) return <EmbedFailedFallback url={embed.url} className={className} />;

  if (embed.kind === 'video') {
    return <VideoPlayer src={embed.url} className={edgeToEdge ? 'rounded-lg border-0' : className} onError={() => setFailed(true)} />;
  }

  if (embed.kind === 'audio') {
    return <AudioPlayer src={embed.url} className={edgeToEdge ? 'max-w-full rounded-lg border-0 bg-transparent shadow-none' : className} onError={() => setFailed(true)} />;
  }

  const rounding = edgeToEdge ? 'rounded-lg' : 'rounded-md border border-border';
  const box = embedImageBox(knownSize, maxWidth);
  return (
    <>
      <button
        ref={boxRef}
        type="button"
        onClick={() => setLightboxOpen(true)}
        style={fitContainer ? undefined : { width: box.width, maxWidth: '100%', height: box.height }}
        className={`block max-w-full cursor-zoom-in ${fitContainer ? '' : `overflow-hidden bg-fill-subtle ${rounding}`} ${className}`}
      >
        <img
          src={embed.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={fitContainer ? undefined : (event: SyntheticEvent<HTMLImageElement>) => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            if (width > 0 && height > 0) setLoadedSize({ width, height });
          }}
          // a known size means the box has the picture's own proportions, so it
          // is filled (a pixel of rounding cropped at most); an unknown one is
          // only fitted inside the fallback box, whatever shape it turns out to be
          className={fitContainer ? `block h-auto max-h-70 max-w-full w-full object-contain ${rounding}` : `block size-full ${knownSize ? 'object-cover' : 'object-contain'}`}
        />
      </button>
      <ImageLightbox src={embed.url} alt="" open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}
