import type { LinkPreviewData } from '@/shared/api/api';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { proxiedImageVariant } from '@/shared/lib/mediaProxy';
import { linkPlayerUrl } from '@/features/media/linkPlayer';
import { canLoadMediaUrl } from '@/features/media/mediaUrl';
import type { ViewerItem } from './viewerItem';

/** The thumbnail strip's cell size, in CSS pixels. */
const VIEWER_THUMB_PX = 56;

function embedViewerKey(url: string, index: number): string {
  return `embed:${url}#${index}`;
}

function fileNameOf(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

/** A direct link to a picture, by the proxied address it is drawn from. */
export function directImageViewerItem(url: string, image: { src: string; width?: number | null; height?: number | null; placeholder?: string | null; animated?: boolean }): ViewerItem {
  return {
    key: embedViewerKey(url, 0),
    src: image.src,
    originalSrc: image.src,
    thumbSrc: proxiedImageVariant(image.src, { width: VIEWER_THUMB_PX, animated: false }),
    width: image.width ?? undefined,
    height: image.height ?? undefined,
    kind: image.animated ? 'gif' : 'image',
    animated: !!image.animated,
    name: fileNameOf(url),
    placeholder: image.placeholder ?? null,
  };
}

/** The pictures a link's card opens in the viewer, as the card draws them: a direct image link's
 * picture, or a page's picture(s). A player (YouTube, Twitch, a preview's own `player`) opens
 * nothing, since its picture is the player's thumbnail, and an external video or sound stays
 * behind its click-to-load gate. Every address here is one the server already handed out, through
 * the media proxy. */
export function embedViewerItems(embed: DetectedEmbed, preview: LinkPreviewData | null | undefined): ViewerItem[] {
  if (!preview) return [];
  if (embed.kind === 'image') {
    const src = preview.image;
    if (!src || !canLoadMediaUrl(src)) return [];
    return [directImageViewerItem(embed.url, {
      src,
      width: preview.imageWidth,
      height: preview.imageHeight,
      placeholder: preview.imagePlaceholder,
      animated: preview.imageAnimated,
    })];
  }
  if (embed.kind !== 'link') return [];
  if (preview.video && canLoadMediaUrl(preview.video)) return [];
  if (linkPlayerUrl(preview.player, window.location.hostname)) return [];
  const images = (preview.images?.length ? preview.images : preview.image ? [preview.image] : []).filter((src) => canLoadMediaUrl(src));
  const name = preview.title || preview.siteName || embed.url;
  return images.map((src, index) => {
    // the measured size, placeholder and animation flag describe `image`, the first picture
    const described = src === preview.image;
    return {
      key: embedViewerKey(embed.url, index),
      src,
      originalSrc: src,
      thumbSrc: proxiedImageVariant(src, { width: VIEWER_THUMB_PX, animated: false }),
      width: described ? preview.imageWidth ?? undefined : undefined,
      height: described ? preview.imageHeight ?? undefined : undefined,
      kind: described && preview.imageAnimated ? 'gif' : 'image',
      animated: described && !!preview.imageAnimated,
      name,
      placeholder: described ? preview.imagePlaceholder ?? null : null,
    } satisfies ViewerItem;
  });
}
