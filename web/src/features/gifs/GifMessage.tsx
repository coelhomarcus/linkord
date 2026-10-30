import { ImageBrokenIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { MediaViewerProvider } from '@/features/chat/MediaViewerProvider';
import { useMediaViewer } from '@/features/chat/useMediaViewer';

/** A sent GIF, loaded straight from KLIPY (their terms: no copies, no proxy).
 * Click opens it in the same viewer as the chat's other pictures. */
export function GifMessage({ url }: { url: string }) {
  const viewer = useMediaViewer();
  const [failed, setFailed] = useState(false);
  if (!viewer) return <MediaViewerProvider><GifMessage url={url} /></MediaViewerProvider>;
  if (failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-label text-text-muted hover:bg-bg-hover">
        <ImageBrokenIcon size={14} className="flex-none" />
        GIF indisponível
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label="Abrir GIF"
      onClick={() => viewer.open([{ src: url, name: 'GIF' }], 0)}
      className="mt-0.5 block max-w-[min(100%,20rem)] cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
    >
      <img
        src={url}
        alt="GIF"
        decoding="async"
        onError={() => setFailed(true)}
        className="block h-auto max-h-72 w-auto max-w-full rounded-lg"
      />
    </button>
  );
}
