import { ImageBrokenIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { ImageLightbox } from './ImageLightbox';
import { ExternalMediaGate } from './ExternalMediaGate';
import { GenericEmbed } from './GenericEmbed';
import { AudioPlayer, VideoPlayer } from './MediaPlayers';
import { availableAttachmentWidth, useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';
import { getCachedLinkPreview, loadLinkPreview } from '@/shared/lib/linkPreviewCache';
import type { LinkPreviewData } from '@/shared/api/api';
import { embedImageBox, previewImageSize, type ImageSize } from './embedImageBox';
import { useNearViewport } from './useNearViewport';
import { canLoadMediaUrl } from './mediaUrl';

type ProxiedImage = { src: string | null; size: ImageSize | null; failed: boolean };

/** A direct image link's picture as the server hands it out, through our own
 * proxy: its host never sees who is reading. Stored with the message (or,
 * in the media grid, signed with the page); otherwise asked for shortly
 * before it scrolls into view. The size is only what was known on the first
 * frame: resizing the row when the answer arrives moved the history on phones
 * (WebKit applies scroll compensation a frame late). */
function useProxiedImage(url: string, ref: RefObject<HTMLElement | null>, enabled: boolean, stored: LinkPreviewData | undefined, signed: string | null | undefined): ProxiedImage {
  const near = useNearViewport(ref);
  const known = stored ?? getCachedLinkPreview(url);
  const [firstSize] = useState(() => previewImageSize(known));
  const [fetched, setFetched] = useState<LinkPreviewData | null | undefined>(undefined);
  const needsFetch = enabled && signed === undefined && !known;
  useEffect(() => {
    if (!needsFetch || !near) return;
    let cancelled = false;
    loadLinkPreview(url)
      .then((data) => { if (!cancelled) setFetched(data); })
      .catch(() => { if (!cancelled) setFetched(null); });
    return () => { cancelled = true; };
  }, [url, near, needsFetch]);
  if (!enabled) return { src: null, size: null, failed: false };
  if (signed !== undefined) return { src: signed, size: null, failed: !signed };
  const data = known ?? fetched;
  return { src: data?.image ?? null, size: previewImageSize(stored) ?? firstSize, failed: data === null || (!!data && !data.image) };
}

function EmbedFailedFallback({ url, className }: { url: string; className: string }) {
  const { t } = useTranslation('media');
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-full max-w-sm items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2.5 text-label text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
    >
      <ImageBrokenIcon size={14} className="flex-none" />
      <span className="truncate">{t('embed.previewFailed')} {t('embed.openLink')}</span>
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
  /** a direct image link's proxied address, signed by the server with the
   * media page (null: the server will not proxy it) */
  imageUrl?: string | null;
}

export function LinkPreview({ embed, className = '', edgeToEdge, fitContainer, preview, imageUrl }: LinkPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const surfaceWidth = useChatSurfaceWidth(384 + 120);
  const maxWidth = availableAttachmentWidth(surfaceWidth, 384);
  const boxRef = useRef<HTMLButtonElement | null>(null);
  const image = useProxiedImage(embed.url, boxRef, embed.kind === 'image', preview, imageUrl);
  const knownSize = fitContainer ? null : image.size;

  if (embed.kind === 'youtube' || embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip' || embed.kind === 'link') {
    return <GenericEmbed key={embed.url} embed={embed} className={className} edgeToEdge={edgeToEdge} preview={preview} />;
  }

  // a picture comes through the proxy, so only its proxied address must be loadable
  if (!canLoadMediaUrl(embed.kind === 'image' ? image.src ?? '/' : embed.url)) return <EmbedFailedFallback url={embed.url} className={className} />;
  if (failed || image.failed) return <EmbedFailedFallback url={embed.url} className={className} />;

  if (embed.kind === 'video') {
    return (
      <ExternalMediaGate url={embed.url} kind="video" className={className}>
        <VideoPlayer src={embed.url} className={edgeToEdge ? 'rounded-lg border-0' : className} onError={() => setFailed(true)} />
      </ExternalMediaGate>
    );
  }

  if (embed.kind === 'audio') {
    return (
      <ExternalMediaGate url={embed.url} kind="audio" className={className}>
        <AudioPlayer src={embed.url} className={edgeToEdge ? 'max-w-full rounded-lg border-0 bg-transparent shadow-none' : className} onError={() => setFailed(true)} />
      </ExternalMediaGate>
    );
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
          src={image.src ?? undefined}
          alt=""
          onError={() => setFailed(true)}
          // a known size means the box has the picture's own proportions, so it
          // is filled (a pixel of rounding cropped at most); an unknown one is
          // only fitted inside the fallback box, whatever shape it turns out to be
          className={fitContainer ? `block h-auto max-h-70 max-w-full w-full object-contain ${rounding}` : `block size-full ${knownSize ? 'object-cover' : 'object-contain'}`}
        />
      </button>
      {image.src && <ImageLightbox src={image.src} alt="" open={lightboxOpen} onOpenChange={setLightboxOpen} />}
    </>
  );
}
