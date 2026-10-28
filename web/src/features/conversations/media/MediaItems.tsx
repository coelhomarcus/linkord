import { ArrowBendUpLeftIcon, PlayIcon } from '@phosphor-icons/react';

import { cn } from '@/shared/lib/utils';
import { useCachedImageSrc } from '@/shared/hooks/useCachedImageSrc';
import type { MediaItem } from '@/shared/api/api';
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from '@/features/chat/ChatAttachment';
import { DocumentAttachmentCard } from '@/features/media/DocumentAttachmentCard';
import { presentFile } from '@/features/media/filePresentation';
import { LinkPreview } from '@/features/media/LinkPreview';
import { viewerItemOf } from './viewerItem';
import { formatMediaDate } from './mediaRows';

// touch screens have no hover, so the controls stay visible there
const REVEAL = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

function JumpButton({ onJump, label, className }: { onJump: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Ir para a mensagem"
      title="Ir para a mensagem"
      onClick={onJump}
      className={cn(
        'z-10 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1.5 text-caption font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60',
        className,
      )}
    >
      <ArrowBendUpLeftIcon size={14} />
      {label}
    </button>
  );
}

function ImageFace({ src, alt }: { src: string; alt: string }) {
  // Left unset while the cache warms (see useCachedImageSrc): a fallback src
  // would fire a second, concurrent request for the same image.
  const cached = useCachedImageSrc(src);
  return <img src={cached ?? undefined} alt={alt} loading="lazy" className="block size-full object-cover" />;
}

function TileFace({ item }: { item: MediaItem }) {
  const { attachment, embed } = item;
  if (embed) return <img src={embed.url} alt="GIF" loading="lazy" className="block size-full object-cover" />;
  if (!attachment) return null;
  const url = `/uploads/${attachment.id}`;
  if (IMAGE_MIME_TYPES.has(attachment.mime)) {
    return <ImageFace src={attachment.thumbId ? `/uploads/${attachment.thumbId}` : url} alt={attachment.name} />;
  }
  if (VIDEO_MIME_TYPES.has(attachment.mime)) {
    return (
      <>
        <video src={`${url}#t=0.1`} muted preload="metadata" playsInline className="pointer-events-none block size-full bg-black object-cover" />
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <span className="grid size-10 place-items-center rounded-full bg-black/60 text-white">
            <PlayIcon size={18} weight="fill" className="ml-0.5" />
          </span>
        </span>
      </>
    );
  }
  const { icon: Icon, iconBgClassName, iconTextClassName, baseName, extension } = presentFile(attachment.name, attachment.mime);
  return (
    <span className="flex size-full flex-col items-center justify-center gap-2 p-3">
      <span className={cn('grid size-12 place-items-center rounded-md', iconBgClassName)}>
        <Icon size={24} className={iconTextClassName} />
      </span>
      <span title={attachment.name} className="flex w-full min-w-0 items-baseline justify-center text-caption text-text-secondary">
        <span className="truncate">{baseName}</span>
        {extension && <span className="flex-none">.{extension}</span>}
      </span>
    </span>
  );
}

/** A square in the grid: opens the viewer (or the file, for what the viewer
 * cannot show), and on hover says who sent it and when. */
export function MediaTile({ item, onOpen, onJump }: { item: MediaItem; onOpen: (item: MediaItem) => void; onJump: (item: MediaItem) => void }) {
  const label = item.attachment?.name ?? 'GIF';
  const viewable = viewerItemOf(item) !== null;
  const faceClass = 'absolute inset-0 block overflow-hidden';
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-bg-tertiary">
      {viewable ? (
        <button type="button" aria-label={`Abrir ${label}`} onClick={() => onOpen(item)} className={cn(faceClass, 'cursor-zoom-in transition-opacity focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/60')}>
          <TileFace item={item} />
        </button>
      ) : (
        <a href={`/uploads/${item.attachment?.id}`} download={item.attachment?.name} aria-label={`Baixar ${label}`} className={cn(faceClass, 'transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/60')}>
          <TileFace item={item} />
        </a>
      )}
      <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-2 pb-1.5 pt-8', REVEAL)}>
        <p className="truncate text-caption font-medium text-white">{item.authorName}</p>
        <p className="truncate text-micro text-white/75">{formatMediaDate(item.ts)}</p>
      </div>
      <JumpButton onJump={() => onJump(item)} className={cn('absolute right-1.5 top-1.5 px-1.5', REVEAL)} />
    </div>
  );
}

function ItemMeta({ item, onJump }: { item: MediaItem; onJump: (item: MediaItem) => void }) {
  return (
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate text-caption text-text-muted">
        {item.authorName} · {formatMediaDate(item.ts)}
      </p>
      <JumpButton onJump={() => onJump(item)} label="Ir para a mensagem" className={cn('flex-none bg-fill-active text-text-secondary hover:bg-fill-hover', REVEAL)} />
    </div>
  );
}

/** A line of the list: a file (audios, documents) or a link card, with who
 * sent it and when underneath. */
export function MediaListItem({ item, onJump }: { item: MediaItem; onJump: (item: MediaItem) => void }) {
  const { attachment, embed } = item;
  return (
    <div className="group flex flex-col gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-fill-subtle">
      {attachment ? (
        <a
          href={`/uploads/${attachment.id}`}
          target="_blank"
          rel="noopener noreferrer"
          download={attachment.name}
          className="flex w-full items-center rounded-lg border border-border bg-bg-tertiary px-3 py-3 transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          <DocumentAttachmentCard name={attachment.name} size={attachment.size} mime={attachment.mime} className="min-w-0 flex-1" />
        </a>
      ) : embed ? (
        <LinkPreview embed={embed} className="w-full max-w-full" fitContainer />
      ) : null}
      <ItemMeta item={item} onJump={onJump} />
    </div>
  );
}
