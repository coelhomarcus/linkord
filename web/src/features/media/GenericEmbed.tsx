import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { getCachedLinkPreview, loadLinkPreview } from '@/shared/lib/linkPreviewCache';
import { proxiedImageVariant, youtubeThumbnailProxyUrl } from '@/shared/lib/mediaProxy';
import type { LinkPreviewData } from '@/shared/api/api';
import { availableAttachmentWidth, useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';
import { cn } from '@/shared/lib/utils';
import { MediaViewerProvider } from '@/features/chat/MediaViewerProvider';
import { useMediaViewer, useOpenMedia } from '@/features/chat/useMediaViewer';
import { embedViewerItems } from './viewer/embedViewerItems';
import { hoverWarmHandlers } from './viewer/hoverWarm';
import { AltTextBadge } from './AltTextBadge';
import { EmbedGallery } from './EmbedGallery';
import { EmbedMenuButton } from './EmbedMenuButton';
import { ExternalMediaGate } from './ExternalMediaGate';
import { AudioPlayer, VideoPlayer } from './MediaPlayers';
import { PreviewImage } from './PreviewImage';
import { TwitchPlayer, YouTubePlayer } from './embedPlayers';
import { embedImageAspect, previewImageSize } from './embedImageBox';
import { canLoadMediaUrl } from './mediaUrl';
import { useAnimatedVariant } from './useAnimatedVariant';
import { useNearViewport } from './useNearViewport';
import { INLINE_VIDEO_MAX_HEIGHT, videoBoxStyle } from './videoBox';

interface GenericEmbedProps {
  embed: DetectedEmbed;
  className?: string;
  /** True when this is the message's only content — drops the outer
   * border/rounding so the card fills the bubble instead of sitting in a
   * second frame nested inside it. */
  edgeToEdge?: boolean;
  /** stored with the message by the server: drawn at once, never fetched */
  preview?: LinkPreviewData;
  /** in a chat message: the keyboard way into its menu (EmbedMenuButton) */
  menu?: boolean;
}

const FAVICON_PX = 14;
const THUMBNAIL_PX = 80;

// no favicon of their own: a picture only ever comes from the server's
// preview, through the media proxy
const KNOWN_SITE: Partial<Record<DetectedEmbed['kind'], { name: string }>> = {
  youtube: { name: 'YouTube' },
  'twitch-channel': { name: 'Twitch' },
  'twitch-vod': { name: 'Twitch' },
  'twitch-clip': { name: 'Twitch' },
};

// a page's theme-color as a border: only plain colour syntax, never a value
// that could mean something else to the style it lands in
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/+-]+\)|[a-z]{3,20})$/i;

/** How a card is laid out, from the type the server gave the page. A preview
 * stored before types existed keeps the layout it always had: text, then the
 * picture full width. */
type Layout = 'media' | 'link' | 'article';

function layoutOf(data: LinkPreviewData, hasText: boolean): Layout {
  if (!hasText && (data.type === 'image' || data.type === 'video' || data.type === 'audio')) return 'media';
  return data.type === 'link' ? 'link' : 'article';
}

export function GenericEmbed(props: GenericEmbedProps) {
  // the viewer the gallery opens is the chat surface's; on its own (a test,
  // a page with no chat) the card brings one
  if (!useMediaViewer()) return <MediaViewerProvider><GenericEmbedCard {...props} /></MediaViewerProvider>;
  return <GenericEmbedCard {...props} />;
}

function GenericEmbedCard({ embed, className = '', edgeToEdge, preview, menu }: GenericEmbedProps) {
  const openMedia = useOpenMedia();
  const cardBorderClass = edgeToEdge ? 'rounded-lg border-0' : 'rounded-md border border-border';
  const surfaceWidth = useChatSurfaceWidth(384 + 120);
  const maxWidth = availableAttachmentWidth(surfaceWidth, 384);
  const { url } = embed;
  // a remount (conversation switch, scrolling back) paints from the cache
  // at once instead of flashing the skeleton
  const [fetched, setData] = useState<LinkPreviewData | null>(() => getCachedLinkPreview(url) ?? null);
  const data = preview ?? fetched;
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const near = useNearViewport(skeletonRef);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    // fetched only when the card is about to be seen: a long history full
    // of links doesn't fire a request per link on open
    if (!near || preview) return;
    let cancelled = false;
    setData(getCachedLinkPreview(url) ?? null);
    setImageFailed(false);
    setVideoFailed(false);
    setAudioFailed(false);
    setFaviconFailed(false);
    loadLinkPreview(url)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ url, title: null, description: null, image: null, video: null, favicon: null, siteName: url, themeColor: null }); });
    return () => { cancelled = true; };
  }, [url, near, preview]);

  const image = data?.image && canLoadMediaUrl(data.image) ? data.image : null;
  const hasText = !!(data?.title || data?.description);
  const layout = data ? layoutOf(data, hasText) : 'article';
  // drawn at the card's width (a thumbnail's, for a plain link), so asked for
  // at that width; an animated one only moves while in view
  const drawnImage = useAnimatedVariant(mediaRef, image, layout === 'link' ? THUMBNAIL_PX : maxWidth, data?.imageAnimated);

  if (!data) {
    return (
      <div ref={skeletonRef} style={{ maxWidth }} className={`flex w-full animate-pulse flex-col overflow-hidden ${cardBorderClass} bg-bg-tertiary ${className}`}>
        <div className="flex flex-col gap-1.5 px-3 pt-2.5 pb-2">
          <div className="h-2.5 w-1/3 rounded-sm bg-bg-hover" />
          <div className="h-3.5 w-3/4 rounded-sm bg-bg-hover" />
        </div>
        {/* same footprint as a card with an og:image at the fallback height */}
        <div className="h-70 w-full bg-bg-hover" />
      </div>
    );
  }

  const known = KNOWN_SITE[embed.kind];
  const video = data.video && canLoadMediaUrl(data.video) && !videoFailed ? data.video : null;
  const audio = data.audio && canLoadMediaUrl(data.audio) && !audioFailed ? data.audio : null;
  if (!hasText && !image && !known && !video && !audio) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ maxWidth }}
        className={`flex w-full items-center gap-2 ${cardBorderClass} bg-bg-tertiary px-3 py-2.5 text-label text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
      >
        <ArrowSquareOutIcon size={14} className="flex-none" />
        <span className="truncate">{data.siteName}</span>
      </a>
    );
  }

  const siteName = data.siteName || known?.name || url;
  const favicon = !faviconFailed && data.favicon && canLoadMediaUrl(data.favicon) ? proxiedImageVariant(data.favicon, { width: FAVICON_PX }) : null;
  const images = (data.images?.length ? data.images : image ? [image] : []).filter((src) => canLoadMediaUrl(src));
  const title = data.title || siteName;
  const openImage = (index: number) => openMedia(embedViewerItems(embed, data), index);
  const alt = data.imageAlt?.trim() || null;

  // a plain link's single picture sits on the right as a thumbnail; otherwise
  // it goes full width under the text
  const asThumbnail = layout === 'link' && images.length === 1;
  const picture = drawnImage && !imageFailed ? (
    <ImageFrame size={asThumbnail ? null : previewImageSize(data)} fill={asThumbnail}>
      <button type="button" onClick={() => openImage(0)} {...hoverWarmHandlers(images[0], { animated: data.imageAnimated })} aria-label={alt ?? title} className="block size-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
        <PreviewImage src={drawnImage} placeholder={data.imagePlaceholder} alt={alt ?? ''} onError={() => setImageFailed(true)} className="size-full object-cover" />
      </button>
      {alt && <AltTextBadge text={alt} />}
    </ImageFrame>
  ) : null;

  let media: ReactNode = null;
  if (embed.kind === 'youtube') {
    media = (
      <div className="aspect-video w-full bg-black">
        <YouTubePlayer
          embed={embed}
          thumbnail={drawnImage || proxiedImageVariant(youtubeThumbnailProxyUrl(embed.youtubeId!), { width: maxWidth })}
          placeholder={drawnImage ? data.imagePlaceholder : null}
        />
      </div>
    );
  } else if (known) {
    media = <div className="w-full bg-black"><TwitchPlayer embed={embed} /></div>;
  } else if (video) {
    // the page's picture stands in for the video until it plays, so its size is the box's
    const posterSize = drawnImage ? previewImageSize(data) : null;
    media = (
      <ExternalMediaGate
        url={video}
        kind="video"
        poster={drawnImage}
        style={posterSize ? videoBoxStyle(posterSize, maxWidth, INLINE_VIDEO_MAX_HEIGHT) : undefined}
        className="max-w-none rounded-none border-0"
      >
        <VideoPlayer
          src={video}
          poster={drawnImage}
          placeholder={drawnImage ? data.imagePlaceholder : null}
          width={posterSize?.width}
          height={posterSize?.height}
          className="max-w-none rounded-none border-0"
          onError={() => setVideoFailed(true)}
        />
      </ExternalMediaGate>
    );
  } else if (audio) {
    media = (
      <div className="flex flex-col">
        {!asThumbnail && picture}
        <ExternalMediaGate url={audio} kind="audio" className="max-w-none rounded-none border-0">
          <AudioPlayer src={audio} title={data.title ?? undefined} className="max-w-none rounded-none border-0" onError={() => setAudioFailed(true)} />
        </ExternalMediaGate>
      </div>
    );
  } else if (images.length > 1) {
    media = <EmbedGallery images={images} width={maxWidth} onOpen={openImage} />;
  } else if (!asThumbnail) {
    media = picture;
  }

  // a picture, a video or a sound with nothing to say about it: the media
  // alone, without a card around it
  if (layout === 'media' && media) {
    return (
      <div ref={mediaRef} style={{ maxWidth }} className={cn('group/embed relative w-full overflow-hidden', cardBorderClass, className)}>
        {media}
        {menu && <EmbedMenuButton />}
      </div>
    );
  }

  const thumbnail = asThumbnail && !known && !video ? picture : null;
  const accent = data.themeColor && COLOR_RE.test(data.themeColor.trim()) ? data.themeColor.trim() : null;
  const style: CSSProperties = { maxWidth, ...(accent ? { borderLeft: `4px solid ${accent}` } : {}) };

  return (
    <div ref={mediaRef} style={style} data-embed-layout={layout} className={cn('group/embed relative flex w-full flex-col overflow-hidden bg-bg-tertiary', cardBorderClass, className)}>
      <div className="flex gap-3 px-3 pt-2.5 pb-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5 pr-7 text-caption text-text-muted">
            {favicon && <img src={favicon} alt="" onError={() => setFaviconFailed(true)} className="h-3.5 w-3.5 flex-none rounded-[3px]" />}
            <span className="truncate">{siteName}</span>
            {data.authorName && (
              <>
                <span aria-hidden>·</span>
                {data.authorUrl
                  ? <a href={data.authorUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{data.authorName}</a>
                  : <span className="truncate">{data.authorName}</span>}
              </>
            )}
          </div>
          {data.title && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-body font-medium text-link hover:underline">
              {data.title}
            </a>
          )}
          {/* a video's description is its uploader's notes: noise on a card */}
          {data.description && embed.kind !== 'youtube' && <p className="line-clamp-3 text-label text-text-secondary">{data.description}</p>}
        </div>
        {thumbnail && <div data-embed-thumbnail className="relative size-20 flex-none overflow-hidden rounded-md">{thumbnail}</div>}
      </div>
      {media}
      {menu && <EmbedMenuButton />}
    </div>
  );
}

/** The box a card's picture is drawn in, sized before the picture arrives so
 * the card never grows: its measured proportions (under 280 px high), or a
 * fixed height. A thumbnail fills the square it is put in instead. */
function ImageFrame({ size, fill, children }: { size: ReturnType<typeof previewImageSize>; fill?: boolean; children: ReactNode }) {
  const aspect = fill ? null : embedImageAspect(size);
  return (
    <div
      data-embed-image
      className={cn('relative bg-fill-subtle', fill ? 'size-full' : 'w-full', !fill && !aspect && 'h-70')}
      style={aspect ? { aspectRatio: aspect, maxHeight: 280 } : undefined}
    >
      {children}
    </div>
  );
}
