import { ImageBrokenIcon } from '@phosphor-icons/react';
import { useState } from 'react';

/** A sent GIF, loaded straight from KLIPY (their terms: no copies, no proxy). */
export function GifMessage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-label text-text-muted hover:bg-bg-hover">
        <ImageBrokenIcon size={14} className="flex-none" />
        GIF indisponível
      </a>
    );
  }
  return (
    <img
      src={url}
      alt="GIF"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="mt-0.5 block h-auto max-h-72 w-auto max-w-[min(100%,20rem)] rounded-lg"
    />
  );
}
