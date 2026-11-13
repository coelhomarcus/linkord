import { ImageBrokenIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MediaViewerProvider } from '@/features/chat/MediaViewerProvider';
import { gifViewerItem } from '@/features/chat/messageViewerItems';
import { useMediaViewer, useOpenMedia } from '@/features/chat/useMediaViewer';
import { useInView } from '@/features/media/useInView';
import { useNearViewport } from '@/features/media/useNearViewport';

/** A sent GIF, loaded straight from KLIPY (their terms: no copies, no proxy,
 * so no still frame to swap in). It loads as it comes near the screen, and
 * animates only while on it: scrolled away, the picture is let go (it stops
 * decoding) and a box of the size it was drawn at holds its place, so the row
 * does not move; back on screen it comes from the browser's cache. Click opens
 * it in the same viewer as the chat's other pictures. */
export function GifMessage({ url }: { url: string }) {
  if (!useMediaViewer()) return <MediaViewerProvider><GifMessageBody url={url} /></MediaViewerProvider>;
  return <GifMessageBody url={url} />;
}

function GifMessageBody({ url }: { url: string }) {
  const { t } = useTranslation('gifs');
  const openMedia = useOpenMedia();
  const open = () => openMedia([gifViewerItem(url)], 0);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLButtonElement | null>(null);
  const near = useNearViewport(boxRef);
  const inView = useInView(boxRef, near);
  const [drawn, setDrawn] = useState<{ width: number; height: number } | null>(null);
  const showing = near && (inView || !drawn);
  if (failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-label text-text-muted hover:bg-bg-hover">
        <ImageBrokenIcon size={14} className="flex-none" />
        {t('message.unavailable')}
      </a>
    );
  }
  return (
    <button
      ref={boxRef}
      type="button"
      aria-label={t('message.open')}
      onClick={open}
      className="mt-0.5 block max-w-[min(100%,20rem)] cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
    >
      {showing ? (
        <img
          src={url}
          alt="GIF"
          decoding="async"
          onLoad={(event) => {
            const { width, height } = event.currentTarget.getBoundingClientRect();
            if (width > 0 && height > 0) setDrawn({ width, height });
          }}
          onError={() => setFailed(true)}
          className="block h-auto max-h-72 w-auto max-w-full rounded-lg"
        />
      ) : (
        <span data-gif-paused="" className="block rounded-lg bg-fill-subtle" style={drawn ?? { width: 160, height: 120 }} />
      )}
    </button>
  );
}
