import { ArrowSquareOutIcon, PlayIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { getCachedLinkPreview, loadLinkPreview } from '@/shared/lib/linkPreviewCache';
import { youtubeThumbnailProxyUrl } from '@/shared/lib/mediaProxy';
import { useNearViewport } from './useNearViewport';
import type { LinkPreviewData } from '@/shared/api/api';
import { availableAttachmentWidth, useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';
import { ExternalMediaGate } from './ExternalMediaGate';
import { VideoPlayer } from './MediaPlayers';
import { embedImageAspect, previewImageSize } from './embedImageBox';
import { canLoadMediaUrl } from './mediaUrl';
import { youtubeEmbedUrl } from './youtubeEmbedUrl';

interface GenericEmbedProps {
  embed: DetectedEmbed;
  className?: string;
  /** True when this is the message's only content — drops the outer
   * border/rounding so the card fills the bubble instead of sitting in a
   * second frame nested inside it. */
  edgeToEdge?: boolean;
  /** stored with the message by the server: drawn at once, never fetched */
  preview?: LinkPreviewData;
}

// no favicon of their own: a picture only ever comes from the server's
// preview, through the media proxy
const KNOWN_SITE: Partial<Record<DetectedEmbed['kind'], { name: string }>> = {
  youtube: { name: 'YouTube' },
  'twitch-channel': { name: 'Twitch' },
  'twitch-vod': { name: 'Twitch' },
  'twitch-clip': { name: 'Twitch' },
};

/** The thumbnail until clicked, then YouTube's own player in an iframe. */
function YouTubePlayer({ embed, thumbnail }: { embed: DetectedEmbed; thumbnail: string }) {
  const { t } = useTranslation('media');
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <iframe
        src={youtubeEmbedUrl(embed.youtubeId!, embed.url)}
        title="YouTube"
        className="h-full w-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      aria-label={t('player.playVideo')}
      className="relative flex size-full items-center justify-center focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <img src={thumbnail} alt="" className="absolute inset-0 size-full object-cover" />
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-red text-white">
        <PlayIcon size={18} fill="currentColor" />
      </span>
    </button>
  );
}

function TwitchPlayer({ embed }: { embed: DetectedEmbed }) {
  const { t } = useTranslation('media');
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    const label = embed.kind === 'twitch-channel'
      ? t('embed.twitchChannel', { channel: embed.twitchChannel })
      : embed.kind === 'twitch-vod'
        ? t('embed.twitchVod')
        : t('embed.twitchClip');
    return (
      <button
        type="button"
        onClick={() => setLoaded(true)}
        className="flex aspect-video w-full items-center justify-center gap-2.5 bg-black/40 text-left transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#9146FF] text-white">
          <PlayIcon size={18} fill="currentColor" />
        </span>
        <span className="text-label text-text-secondary">{label}: {t('embed.loadPlayer')}</span>
      </button>
    );
  }

  const parent = window.location.hostname;
  let src = '';
  if (embed.kind === 'twitch-channel') src = `https://player.twitch.tv/?channel=${embed.twitchChannel}&parent=${parent}`;
  if (embed.kind === 'twitch-vod') src = `https://player.twitch.tv/?video=${embed.twitchVideoId}&parent=${parent}`;
  if (embed.kind === 'twitch-clip') src = `https://clips.twitch.tv/embed?clip=${embed.twitchClipSlug}&parent=${parent}`;
  return (
    <div className="aspect-video w-full">
      <iframe src={src} title="Twitch" className="h-full w-full" allowFullScreen />
    </div>
  );
}

export function GenericEmbed({ embed, className = '', edgeToEdge, preview }: GenericEmbedProps) {
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
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    // fetched only when the card is about to be seen: a long history full
    // of links doesn't fire a request per link on open
    if (!near || preview) return;
    let cancelled = false;
    setData(getCachedLinkPreview(url) ?? null);
    setImageFailed(false);
    setVideoFailed(false);
    setFaviconFailed(false);
    loadLinkPreview(url)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ url, title: null, description: null, image: null, video: null, favicon: null, siteName: url, themeColor: null }); });
    return () => { cancelled = true; };
  }, [url, near, preview]);

  const known = KNOWN_SITE[embed.kind];
  const hasKnownPlayer = !!known;

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

  const image = data.image && canLoadMediaUrl(data.image) ? data.image : null;
  const video = data.video && canLoadMediaUrl(data.video) ? data.video : null;
  if (!data.title && !data.description && !image && !hasKnownPlayer) {
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
  const candidateFavicon = data.favicon;
  const favicon = !faviconFailed && candidateFavicon && canLoadMediaUrl(candidateFavicon) ? candidateFavicon : null;
  const playableVideo = !!video && !videoFailed;

  const aspect = image ? embedImageAspect(previewImageSize(data)) : null;
  let media: ReactNode = null;
  if (embed.kind === 'youtube') {
    media = (
      <div className="aspect-video w-full bg-black">
        <YouTubePlayer embed={embed} thumbnail={image || youtubeThumbnailProxyUrl(embed.youtubeId!)} />
      </div>
    );
  } else if (embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip') {
    media = <div className="w-full bg-black"><TwitchPlayer embed={embed} /></div>;
  } else if (playableVideo) {
    media = (
      <ExternalMediaGate url={video!} kind="video" poster={image} className="max-w-none rounded-none border-0">
        <VideoPlayer src={video!} poster={image} className="max-w-none rounded-none border-0" onError={() => setVideoFailed(true)} />
      </ExternalMediaGate>
    );
  } else if (image && !imageFailed) {
    media = (
      // the frame is sized before the picture arrives (its measured
      // proportions, or a fixed height when unknown): the card must not grow
      <div
        className={`w-full bg-fill-subtle ${aspect ? '' : 'h-70'}`}
        style={aspect ? { aspectRatio: aspect, maxHeight: 280 } : undefined}
      >
        <img
          src={image}
          alt=""
          onError={() => setImageFailed(true)}
          className="size-full object-cover"
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth }} className={`flex w-full flex-col overflow-hidden bg-bg-tertiary ${cardBorderClass} ${className}`}>
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-1.5 text-caption text-text-muted">
          {favicon && <img src={favicon} alt="" onError={() => setFaviconFailed(true)} className="h-3.5 w-3.5 flex-none rounded-[3px]" />}
          <span className="truncate">{siteName}</span>
        </div>
        {data.title && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-body font-medium text-link hover:underline"
          >
            {data.title}
          </a>
        )}
        {data.description && <p className="line-clamp-3 text-label text-text-secondary">{data.description}</p>}
      </div>

      {media}
    </div>
  );
}
