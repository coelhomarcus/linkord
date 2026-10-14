import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { ImageLightbox } from './ImageLightbox';
import { GenericEmbed } from './GenericEmbed';
import { AudioPlayer, VideoPlayer } from './MediaPlayers';
import { availableAttachmentWidth, useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';

// A picture from an arbitrary URL has no known size, so it gets a box of fixed
// height (and a px width) that it is fitted into: loading it then changes
// nothing in the row, instead of growing it from zero under the reader.
const EMBED_IMAGE_BOX_HEIGHT = 280;

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
}

export function LinkPreview({ embed, className = '', edgeToEdge, fitContainer }: LinkPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const surfaceWidth = useChatSurfaceWidth(384 + 120);
  const maxWidth = availableAttachmentWidth(surfaceWidth, 384);

  if (embed.kind === 'youtube' || embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip' || embed.kind === 'link') {
    return <GenericEmbed key={embed.url} embed={embed} className={className} edgeToEdge={edgeToEdge} />;
  }

  if (failed) return <EmbedFailedFallback url={embed.url} className={className} />;

  if (embed.kind === 'video') {
    return <VideoPlayer src={embed.url} className={edgeToEdge ? 'rounded-lg border-0' : className} onError={() => setFailed(true)} />;
  }

  if (embed.kind === 'audio') {
    return <AudioPlayer src={embed.url} className={edgeToEdge ? 'max-w-full rounded-lg border-0 bg-transparent shadow-none' : className} onError={() => setFailed(true)} />;
  }

  const rounding = edgeToEdge ? 'rounded-lg' : 'rounded-md border border-border';
  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        style={fitContainer ? undefined : { width: maxWidth, maxWidth: '100%', height: EMBED_IMAGE_BOX_HEIGHT }}
        className={`block max-w-full cursor-zoom-in ${fitContainer ? '' : `overflow-hidden bg-fill-subtle ${rounding}`} ${className}`}
      >
        <img
          src={embed.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={fitContainer ? `block h-auto max-h-70 max-w-full w-full object-contain ${rounding}` : 'block size-full object-contain'}
        />
      </button>
      <ImageLightbox src={embed.url} alt="" open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}
